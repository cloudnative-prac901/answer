#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { NetStack } from '../lib/net-stack';
import { VpceStack } from '../lib/vpce-stack';
import { AcmStack } from '../lib/acm-stack';
import { AlbStack } from '../lib/alb-stack';
import { Alb2Stack } from '../lib/alb2-stack';  // ★追加
import { EcrStack } from '../lib/ecr-stack';
import { RdsStack } from '../lib/rds-stack';
import { EcsStack } from '../lib/ecs-stack';
import { Ecs2Stack } from '../lib/ecs2-stack';  // ★追加
import { ConnectionStack } from '../lib/connection-stack';
import { IamStack } from '../lib/iam-stack';
import { BuildStack } from '../lib/build-stack';
import { Build2Stack } from '../lib/build2-stack';  // ★追加
import { DeployStack } from '../lib/deploy-stack';
import { Deploy2Stack } from '../lib/deploy2-stack';  // ★追加
import { PipelineStack } from '../lib/pipeline-stack';
import { Pipeline2Stack } from '../lib/pipeline2-stack';  // ★追加

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

// ACM
const acm = new AcmStack(app, 'AcmStack', {
  env,
  domainName: '<公開したいサブドメイン>',             // 公開したいサブドメイン (例：app.example.com)
  hostedZoneName: '<Route53に登録済のホストゾーン>',  // Route53に登録済ホストゾーン (例：example.com)
});

// ALB / WAF for CustomerInfoApp
const alb = new AlbStack(app, 'AlbStack', {
  env,
  vpc: net.vpc,
  albSg: net.albSg,
  certificateArn: acm.certificateArn,
  domainName: '<公開したいサブドメイン>',
  hostedZoneName: '<Route53に登録済のホストゾーン>',
});

// ALB / WAF for FortuneTellingApp　★追加
const alb2 = new Alb2Stack(app, 'Alb2Stack', {
  env,
  vpc: net.vpc,
  albSg: net.alb2Sg,
});

// ECR
const ecr = new EcrStack(app, 'EcrStack', { env });

// RDS
const rds = new RdsStack(app, 'RdsStack', {
  env,
  vpc: net.vpc,
  dbSg: net.dbSg,
});

// ECS / Fargate for CustomerInfoApp
const ecs = new EcsStack(app, 'EcsStack', {
  env,
  vpc        : net.vpc,
  ecsSg      : net.ecsSg,
  repo       : ecr.customerInfoRepo,  // ★変数名を修正
  targetGroup: alb.tgBlue,
});

// ECS / Fargate for FortuneTellingApp  ★セクション追加
const ecs2 = new Ecs2Stack(app, 'Ecs2Stack', {
  env,
  vpc        : net.vpc,
  ecsSg      : net.ecsSg,
  repo       : ecr.fortuneTellingRepo,
  targetGroup: alb2.tgBlue,
});

// CodeConnection
const conn = new ConnectionStack(app, 'ConnectionStack', { env });

// IAM  ★複数のデータを渡せるように一部パラメータを配列化
const iam = new IamStack(app, 'IamStack', {
  env,
  ecrRepoNames: ['customer-info/app', 'fortune-telling/app'],
  pipelineNames: ['CustomerInfoPipeline', 'FortuneTellingPipeline'],
  ghRepos: [
    { owner: 'xxx', repo: 'customer-info', branches: ['main'] },
    { owner: 'xxx', repo: 'fortune-telling', branches: ['main'] },
  ],
  gitHubConnectionArn: conn.connectionArn,
  appSecretArns: [ rds.appSecret.secretArn, rds.fortuneAppSecret.secretArn ],  // アプリケーション用の認証情報
});

// CodeBuild for customer-info
const build = new BuildStack(app, 'BuildStack', {
  env,
  codeBuildRoleArn: iam.codeBuildRole.roleArn,
  ecrRepoName: 'customer-info/app',
});

// CodeBuild for fortune-telling  ★セクション追加
const build2 = new Build2Stack(app, 'Build2Stack', {
  env,
  codeBuildRoleArn: iam.codeBuildRole.roleArn,
  ecrRepoName: 'fortune-telling/app',
});

// CodeDeploy for customer-info
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

// CodeDeploy for fortune-telling  ★セクション追加
const deploy2 = new Deploy2Stack(app, 'DeployStack', {
  env,
  clusterName: ecs2.cluster.clusterName,
  serviceName: ecs2.service.serviceName,
  prodListenerArn: alb2.listenerProd.listenerArn,
  testListenerArn: alb2.listenerTest.listenerArn,
  tgBlueName: alb2.tgBlue.targetGroupName,
  tgGreenName: alb2.tgGreen.targetGroupName,
  codeDeployRoleArn: iam.codeDeployRole.roleArn,
  applicationName: 'FortuneTellingEcsApp',
  deploymentGroupName: 'FortuneTellingDG',
});

// CodePipeline for customer-info
new PipelineStack(app, 'PipelineStack', {
  env,
  pipelineName       : 'CustomerInfoPipeline',
  codeBuildRoleArn   : iam.codeBuildRole.roleArn,
  codeDeployRoleArn  : iam.codeDeployRole.roleArn,
  codePipelineRoleArn: iam.codePipelineRole.roleArn,
  ecsTaskExecutionRoleArn: iam.ecsTaskExecutionRole.roleArn,
  ecsTaskRoleArn         : iam.appTaskRole.roleArn,
  ecrRepoName        : 'customer-info/app',
  gitHubConnectionArn: conn.connectionArn,                   // CodeConnections承認後に有効
  gitHubOwner        : '<xxx>',                              // GitHubユーザ名に修正
  gitHubRepo         : 'customer-info',
  gitHubBranch       : 'main',
  ecsAppName         : 'CustomerInfoEcsApp',
  ecsDeploymentGroupName: 'CustomerInfoDG',
  dbSecretArn            : rds.appSecret.secretArn,
  dbHost                 : rds.dbHost,
});

// CodePipeline for fortune-telling  ★セクション追加
new Pipeline2Stack(app, 'Pipeline2Stack', {
  env,
  pipelineName        : 'FortuneTellingPipeline',
  codeBuildRoleArn    : iam.codeBuildRole.roleArn,
  codeDeployRoleArn   : iam.codeDeployRole.roleArn,
  codePipelineRoleArn : iam.codePipelineRole.roleArn,
  ecsTaskExecutionRoleArn : iam.ecsTaskExecutionRole.roleArn,
  ecsTaskRoleArn          : iam.appTaskRole.roleArn,
  ecrRepoName         : 'fortune-telling/app',
  gitHubConnectionArn : conn.connectionArn,
  gitHubOwner         : '<xxx>',                   // GitHubユーザ名に修正
  gitHubRepo          : 'fortune-telling',
  gitHubBranch        : 'main',
  ecsAppName              : 'FortuneTellingEcsApp',
  ecsDeploymentGroupName  : 'FortuneTellingDG',
  dbSecretArn             : rds.fortuneAppSecret.secretArn,
  dbHost                  : rds.dbHost,
});
