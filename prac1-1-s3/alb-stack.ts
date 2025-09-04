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
}

// 3. 公開プロパティ
export class AlbStack extends Stack {
  public readonly albDnsName: string;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

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
    const tg = new elbv2.ApplicationTargetGroup(this, 'AlbTg', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/', interval: Duration.seconds(30) },
    });

    this.targetGroup = tg;

    // 7. HTTPリスナーの作成
    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [tg],
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
    new CfnOutput(this, 'AlbTgArn',     { value: tg.targetGroupArn        });
  }
}
