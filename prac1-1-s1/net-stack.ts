// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

// 2. クラス宣言、他スタックに公開するプロパティ
export class NetStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly ecsSg: ec2.SecurityGroup;
  public readonly vpceSg: ec2.SecurityGroup;
  public readonly albSg: ec2.SecurityGroup;
  public readonly dbSg: ec2.SecurityGroup;
  public readonly jumpSg: ec2.SecurityGroup;

// 3. スタック初期化
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 4. VPC＋サブネット作成
    this.vpc = new ec2.Vpc(this, 'AppVpc', {
      cidr: '10.0.0.0/16',
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'alb-public',     subnetType: ec2.SubnetType.PUBLIC,           cidrMask: 24 },
        { name: 'jumpbox-public', subnetType: ec2.SubnetType.PUBLIC,           cidrMask: 24 },
        { name: 'ecs-private',    subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'vpce-private',   subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'db-private',     subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      natGateways: 0,
    });

    // 5. セキュリティグループ
    // AlbSg
    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'Security Group for ALB',
      allowAllOutbound: false,
    });

    // EcsSg
    this.ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'Security Group for ECS Service',
      allowAllOutbound: true,
    });

    // DbSg
    this.dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'Security Group for RDS',
      allowAllOutbound: false,
    });

    // JumpSg
    this.jumpSg = new ec2.SecurityGroup(this, 'JumpSg', {
      vpc: this.vpc,
      description: 'Security Group for JumpBox',
      allowAllOutbound: true,
    });

    // VpceSg
    this.vpceSg = new ec2.SecurityGroup(this, 'VpceSg', {
      vpc: this.vpc,
      description: 'Security Group for VPC Endpoints',
      allowAllOutbound: true,
    });

    // 6. セキュリティグループ間の通信ルール
    // ALB: InternetからHTTP/HTTPSを許可
    this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from Internet');
    this.albSg.addEgressRule(this.ecsSg, ec2.Port.tcp(80), 'ALB-to-ECS');

    // ECS: ALBからHTTPアクセスを許可
    this.ecsSg.addIngressRule(this.albSg, ec2.Port.tcp(80), 'ALB-to-ECS');

    // DB: ECSおよびJumpBoxからMySQLアクセスを許可
    this.dbSg.addIngressRule(this.ecsSg, ec2.Port.tcp(3306), 'ECS-to-DB');
    this.dbSg.addIngressRule(this.jumpSg, ec2.Port.tcp(3306), 'JumpBox-to-DB');

    // VPC Endpoint: ECSからHTTPSアクセスを許可
    this.vpceSg.addIngressRule(this.ecsSg, ec2.Port.tcp(443), 'ECS-to-VPCE');

    // 7. 出力
    new CfnOutput(this, 'VpcId',   { value: this.vpc.vpcId });
    new CfnOutput(this, 'EcsSgId',   { value: this.ecsSg.securityGroupId });
    new CfnOutput(this, 'AlbSgId',   { value: this.albSg.securityGroupId });
    new CfnOutput(this, 'JumpSgId',  { value: this.jumpSg.securityGroupId });
    new CfnOutput(this, 'DbSgId',    { value: this.dbSg.securityGroupId });
    new CfnOutput(this, 'VpceSgId',  { value: this.vpceSg.securityGroupId });
  }
}
