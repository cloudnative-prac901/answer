#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { NetStack } from '../lib/net-stack';
import { VpceStack } from '../lib/vpce-stack';
import { AcmStack } from '../lib/acm-stack';  //★追加
import { AlbStack } from '../lib/alb-stack';
import { EcrStack } from '../lib/ecr-stack';
import { RdsStack } from '../lib/rds-stack';
import { EcsStack } from '../lib/ecs-stack';
import { ConnectionStack } from '../lib/connection-stack';
import { IamStack } from '../lib/iam-stack';
import { BuildStack } from '../lib/build-stack';
import { DeployStack } from '../lib/deploy-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region : process.env.CDK_DEFAULT_REGION,
};

// VPC / Subnets / SecurityGroups
const net = new NetStack(app, 'NetStack', { env });

// VPC Endpoints
new VpceStack(app, 'VpceStack', {
  env,
  vpc: net.vpc,
  vpceSg: net.vpceSg,
  ecsSg: net.ecsSg,
  jumpSg: net.jumpSg
});

// ACM  ★追加
const acm = new AcmStack(app, 'AcmStack', {
  env,
  domainName: '<公開したいサブドメイン>',             // 公開したいサブドメイン (例：app.example.com)
  hostedZoneName: '<Route53に登録済のホストゾーン>',  // Route53に登録済ホストゾーン (例：example.com)
});

// ALB / WAF
const alb = new AlbStack(app, 'AlbStack', {
  env,
  vpc: net.vpc,
  albSg: net.albSg,
  certificateArn: acm.certificateArn,  // ★追加（ALBのリスナーにTLS証明書を追加するため）
});

// ECR
const ecr = new EcrStack(app, 'EcrStack', { env });

// RDS
const rds = new RdsStack(app, 'RdsStack', {
  env,
  vpc: net.vpc,
  dbSg: net.dbSg,
});

// ECS / Fargate
const ecs = new EcsStack(app, 'EcsStack', {
  env,
  vpc        : net.vpc,
  ecsSg      : net.ecsSg,
  repo       : ecr.repository,
  targetGroup: alb.tgBlue,
  //targetGroup: alb.targetGroup,
});

// CodeConnection
const conn = new ConnectionStack(app, 'ConnectionStack', { env });

// IAM
const iam = new IamStack(app, 'IamStack', {
  env,
  ecrRepoName : 'customer-info/app',
  pipelineName: 'CustomerInfoPipeline',
  ghOwner     : 'xxx',  // GitHubユーザー名
  ghRepo      : 'customer-info',  // GitHubリポジトリ名
  gitHubConnectionArn: conn.connectionArn,
  appSecretArn: rds.appSecret.secretArn,  // アプリケーション用の認証情報
});

// CodeBuild
const build = new BuildStack(app, 'BuildStack', {
  env,
  codeBuildRoleArn: iam.codeBuildRole.roleArn,
  ecrRepoName: 'customer-info/app',
});

// CodeDeploy
const deploy = new DeployStack(app, 'DeployStack', {
  env,
  clusterName: ecs.cluster.clusterName,
  serviceName: ecs.service.serviceName,
  prodListenerArn: alb.listenerProd.listenerArn,
  testListenerArn: alb.listenerTest.listenerArn,
  tgBlueName: alb.tgBlue.targetGroupName,
  tgGreenName: alb.tgGreen.targetGroupName,
  codeDeployRoleArn: iam.codeDeployRole.roleArn,
  applicationName: 'CustomerInfoEcsApp',
  deploymentGroupName: 'CustomerInfoDG',
});

// CodePipeline
new PipelineStack(app, 'PipelineStack', {
  env,
  pipelineName       : 'CustomerInfoPipeline',
  codeBuildRoleArn   : iam.codeBuildRole.roleArn,
  codeDeployRoleArn  : iam.codeDeployRole.roleArn,
  codePipelineRoleArn: iam.codePipelineRole.roleArn,
  ecrRepoName        : 'customer-info/app',
  gitHubConnectionArn: conn.connectionArn,                   // CodeConnections承認後に有効
  gitHubOwner        : '<xxx>',                              // GitHubユーザ名に修正
  gitHubRepo         : 'customer-info',
  gitHubBranch       : 'main',
  ecsAppName         : 'CustomerInfoEcsApp',
  ecsDeploymentGroupName: 'CustomerInfoDG',
  ecsTaskExecutionRoleArn: iam.ecsTaskExecutionRole.roleArn,
  ecsTaskRoleArn         : iam.appTaskRole.roleArn,
  dbSecretArn            : rds.appSecret.secretArn,
  dbHost                 : rds.dbHost,
});
