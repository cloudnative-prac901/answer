#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { NetStack } from '../lib/net-stack';
import { VpceStack } from '../lib/vpce-stack';
import { AlbStack } from '../lib/alb-stack';
import { EcrStack } from '../lib/ecr-stack';
import { RdsStack } from '../lib/rds-stack';
import { EcsStack } from '../lib/ecs-stack';
import { ConnectionStack } from '../lib/connection-stack';
import { IamStack } from '../lib/iam-stack';
import { BuildStack } from '../lib/build-stack';
import { DeployStack } from '../lib/deploy-stack';  //★追加

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

// ALB / WAF
const alb = new AlbStack(app, 'AlbStack', {
  env,
  vpc: net.vpc,
  albSg: net.albSg,
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
  targetGroup: alb.tgBlue,                    //★プロパティ変更
  //targetGroup: alb.targetGroup,             //★プロパティ変更のためコメントアウト
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

// Build Stack
const build = new BuildStack(app, 'BuildStack', {
  env,
  codeBuildRoleArn: iam.codeBuildRole.roleArn,
  ecrRepoName: 'customer-info/app',
});

// Deploy Stack　　★追加
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
