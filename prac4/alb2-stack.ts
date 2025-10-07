// 1. インポート
import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2   from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

// 2. インタフェース定義（1つめと同じ）
export interface Alb2StackProps extends StackProps {
  vpc        : ec2.IVpc;
  albSg      : ec2.ISecurityGroup;
  albSubnets?: ec2.SubnetSelection;   // 無指定なら 'alb-public' を自動選択
}

// 3. 公開プロパティ
export class Alb2Stack extends Stack {
  public readonly alb2DnsName: string;

  // B/Gデプロイ用リスナーおよびターゲットグループ
  public readonly listenerProd: elbv2.ApplicationListener; // 本番:80ポート
  public readonly listenerTest: elbv2.ApplicationListener; // テスト:9001ポート

  public readonly tgBlue : elbv2.ApplicationTargetGroup;   // 初期：本番
  public readonly tgGreen: elbv2.ApplicationTargetGroup;   // 初期：テスト

  // 4. スタック初期化
  constructor(scope: Construct, id: string, props: Alb2StackProps) {
    super(scope, id, props);

    if (!props.albSg) {
      throw new Error('Alb2Stack requires pre-created albSg from NetStack');
    }

    // サブネット選択（同一 AZ 重複を防ぐ）
    const subnetSel = props.albSubnets ??
      props.vpc.selectSubnets({ subnetGroupName: 'alb-public' });

    // 5. Application Load Balancer 作成（新規アプリ用）
    const alb2 = new elbv2.ApplicationLoadBalancer(this, 'Alb2', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSg,
      loadBalancerName: 'FortuneTellingAlb',
      vpcSubnets: subnetSel,
    });

    // 6. ターゲットグループ作成
    // Blue/Green 用ターゲットグループ（HTTP:80）
    this.tgBlue = new elbv2.ApplicationTargetGroup(this, 'TgBlue2', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/', interval: Duration.seconds(30) },
    });

    this.tgGreen = new elbv2.ApplicationTargetGroup(this, 'TgGreen2', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/', interval: Duration.seconds(30) },
    });

    // 7. HTTPリスナー（本番/テスト）
    // 本番リスナー (80)：初期は Blue を適用
    this.listenerProd = alb2.addListener('HttpListenerProd2', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.tgBlue],
    });

    // テストリスナー (9001)：初期は Green を適用
    this.listenerTest = alb2.addListener('HttpListenerTest2', {
      port: 9001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.tgGreen],
    });

    // 8. WAFルール（BadBot ブロック）※1つめと同内容
    const badBotRule2: wafv2.CfnWebACL.RuleProperty = {
      name: 'BlockBadBotUA2',
      priority: 0,
      action: { block: {} },
      statement: {
        byteMatchStatement: {
          fieldToMatch: { singleHeader: { name: 'user-agent' } },
          positionalConstraint: 'CONTAINS',
          searchString: 'BadBot',
          textTransformations: [{ priority: 0, type: 'NONE' }],
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'BlockBadBotUA2',
      },
    };

    // 9. WAFルール（AWSマネージドルール）※1つめと同内容
    const awsManagedCommon2: wafv2.CfnWebACL.RuleProperty = {
      name: 'AWSManagedCommonRuleSet2',
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
        metricName: 'AWSCommonRuleSet2',
      },
    };

    // 10. WebACL 作成（新規ALB用）
    const webAcl2 = new wafv2.CfnWebACL(this, 'Alb2WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'Alb2WebAcl',
      },
      rules: [badBotRule2, awsManagedCommon2],
    });

    // 11. ALB と WebACL の関連付け
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation2', {
      resourceArn: alb2.loadBalancerArn,
      webAclArn  : webAcl2.attrArn,
    });

    // 12. 出力
    this.alb2DnsName = alb2.loadBalancerDnsName;
    new CfnOutput(this, 'Alb2DnsName',        { value: alb2.loadBalancerDnsName  });
    new CfnOutput(this, 'Alb2WebAclArn',      { value: webAcl2.attrArn           });
    // 本番/テスト用リスナーの出力を追加
    new CfnOutput(this, 'ProdListenerArn',   { value: this.listenerProd.listenerArn });
    new CfnOutput(this, 'TestListenerArn',   { value: this.listenerTest.listenerArn });
    // B/Gデプロイ用ターゲットグループの名前およびARN
    new CfnOutput(this, 'TgBlueName',        { value: this.tgBlue.targetGroupName });
    new CfnOutput(this, 'TgGreenName',       { value: this.tgGreen.targetGroupName });
    new CfnOutput(this, 'TgBlueArn',         { value: this.tgBlue.targetGroupArn });
    new CfnOutput(this, 'TgGreenArn',        { value: this.tgGreen.targetGroupArn });
  }
}
