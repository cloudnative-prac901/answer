// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

// 2. インターフェース定義
export interface VpceStackProps extends StackProps {
  vpc: ec2.IVpc;
  vpceSg: ec2.ISecurityGroup;
  ecsSg: ec2.ISecurityGroup;
}

// 3. スタック初期化
export class VpceStack extends Stack {
  constructor(scope: Construct, id: string, props: VpceStackProps) {
    super(scope, id, props);
    const { vpc, vpceSg, ecsSg } = props;

    // isolated サブネットを割り当て
    const vpceSubnets: ec2.SubnetSelection = { subnets: vpc.isolatedSubnets };

    // 4. Gatewayエンドポイント作成（S3）
    new ec2.GatewayVpcEndpoint(this, 'S3Gateway', {
      vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [vpceSubnets],
    });

    // 5. Interfaceエンドポイント作成
    // Interface エンドポイント（ECR API）
    new ec2.InterfaceVpcEndpoint(this, 'EcrApiEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });

    // Interface エンドポイント（ECR Docker）
    new ec2.InterfaceVpcEndpoint(this, 'EcrDkrEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });

    // Interface エンドポイント（Secrets Manager）
    new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });

    // Interface エンドポイント（CloudWatchLogs)
    new ec2.InterfaceVpcEndpoint(this, 'LogsEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });

    // Interface エンドポイント（SSM / ECS Exec）
    new ec2.InterfaceVpcEndpoint(this, 'SsmEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });

    new ec2.InterfaceVpcEndpoint(this, 'SsmMessagesEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });

    new ec2.InterfaceVpcEndpoint(this, 'Ec2MessagesEp', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      subnets: vpceSubnets,
      securityGroups: [vpceSg],
    });
  }
}
