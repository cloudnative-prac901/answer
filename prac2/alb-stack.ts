// 1. インポート
import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2   from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

// 2. インタフェース定義
export interface AlbStackProps extends StackProps {
  vpc        : ec2.IVpc;
  albSg      : ec2.ISecurityGroup;
  albSubnets?: ec2.SubnetSelection;   // 指定が無ければ 'alb-public' グループを自動選択
  certificateArn: string;             // ★追加
}

// 3. 公開プロパティ
export class AlbStack extends Stack {
  public readonly albDnsName: string;

  public readonly listenerProd: elbv2.ApplicationListener;  // 本番：HTTPS 443
  public readonly listenerTest: elbv2.ApplicationListener;  // テスト：HTTPS:9001

  public readonly tgBlue : elbv2.ApplicationTargetGroup;   // 初期：本番
  public readonly tgGreen: elbv2.ApplicationTargetGroup;   // 初期：テスト

  // 4. スタック初期化
  constructor(scope: Construct, id: string, props: AlbStackProps) {
    super(scope, id, props);

    if (!props.albSg) {
      throw new Error('AlbStack requires pre-created albSg from NetStack');
    }

    // サブネット選択（同一 AZ 重複を防ぐ）
    const subnetSel = props.albSubnets ??
      props.vpc.selectSubnets({ subnetGroupName: 'alb-public' });

    // 5. Application Load Balancerの作成
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSg,
      loadBalancerName: 'CustomerInfoAlb',
      vpcSubnets: subnetSel,
    });

    // 6. 空ターゲットグループ（後で Fargate を登録）
    // Blue/Green 用ターゲットグループ（HTTP:80）
    this.tgBlue = new elbv2.ApplicationTargetGroup(this, 'TgBlue', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/', interval: Duration.seconds(30) },
    });

    this.tgGreen = new elbv2.ApplicationTargetGroup(this, 'TgGreen', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/', interval: Duration.seconds(30) },
    });

    // 7. HTTPリスナーの作成
    // HTTP用リスナー（HTTP(80)はTGへフォワードせず、HTTPS(443)へ301リダイレクト）  ★追加
    alb.addListener('HttpListenerRedirect', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true, // 301
      }),
    });

    // Blue/Green 用リスナー
    // 本番リスナー (443) : 初期はBlueを本番に適用（★80→443に変更）
    this.listenerProd = alb.addListener('HttpsListenerProd', {  // ★修正
      port: 443,                                                // ★修正
      protocol: elbv2.ApplicationProtocol.HTTPS,                // ★修正
      certificates: [{ certificateArn: props.certificateArn }], // ★追加
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,               // ★追加
      defaultTargetGroups: [this.tgBlue],
    });

    // テストリスナー (9001) : 初期はGreenをテストに適用（★ポートは変更なし）
    this.listenerTest = alb.addListener('HttpsListenerTest', {  // ★修正
      port: 9001,
      protocol: elbv2.ApplicationProtocol.HTTP,                 // ★修正
      certificates: [{ certificateArn: props.certificateArn }], // ★追加
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,               // ★追加
      defaultTargetGroups: [this.tgGreen],
    });

    // 8. WAFルール作成（BadBotブロック）
    const badBotRule: wafv2.CfnWebACL.RuleProperty = {
      name: 'BlockBadBotUA',
      priority: 0,
      action: { block: {} },
      statement: {
        byteMatchStatement: {
          fieldToMatch: { singleHeader: { name: 'user-agent' } }, //
          positionalConstraint: 'CONTAINS',
          searchString: 'BadBot',
          textTransformations: [{ priority: 0, type: 'NONE' }],
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'BlockBadBotUA',
      },
    };

    // 9. WAFルール作成（AWSマネージドルール）
    const awsManagedCommon: wafv2.CfnWebACL.RuleProperty = {
      name: 'AWSManagedCommonRuleSet',
      priority: 1,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'AWSCommonRuleSet',
      },
    };

    // 10. WebACL作成
    const webAcl = new wafv2.CfnWebACL(this, 'AlbWebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'AlbWebAcl',
      },
      rules: [badBotRule, awsManagedCommon],
    });

    // 11. ALB と WebACL の関連付け
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: alb.loadBalancerArn,
      webAclArn  : webAcl.attrArn,
    });

    // 12. 出力
    this.albDnsName = alb.loadBalancerDnsName;
    new CfnOutput(this, 'AlbDnsName',   { value: alb.loadBalancerDnsName  });
    new CfnOutput(this, 'AlbWebAclArn', { value: webAcl.attrArn           });

    // 本番/テスト用リスナーの出力を追加
    new CfnOutput(this, 'ProdListenerArn',   { value: this.listenerProd.listenerArn });
    new CfnOutput(this, 'TestListenerArn',   { value: this.listenerTest.listenerArn });

    // B/Gデプロイ用ターゲットグループの名前およびARNを追加
    new CfnOutput(this, 'TgBlueName',        { value: this.tgBlue.targetGroupName });
    new CfnOutput(this, 'TgGreenName',       { value: this.tgGreen.targetGroupName });
    new CfnOutput(this, 'TgBlueArn',         { value: this.tgBlue.targetGroupArn });
    new CfnOutput(this, 'TgGreenArn',        { value: this.tgGreen.targetGroupArn });
  }
}
