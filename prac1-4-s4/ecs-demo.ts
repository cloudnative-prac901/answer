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
import { BuildStack } from '../lib/build-stack';  // ★追加

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
  targetGroup: alb.targetGroup,
});

// CodeConnection
const conn = new ConnectionStack(app, 'ConnectionStack', { env });

// IAM
const iam = new IamStack(app, 'IamStack', {
  env,
  ecrRepoName : 'customer-info/app',
  pipelineName: 'CustomerInfoPipeline',
  ghOwner     : 'xxx',  // GitHubユーザー名（ご自身の環境に合わせて適宜変更してください）
  ghRepo      : 'customer-info',  // GitHubリポジトリ名
  gitHubConnectionArn: conn.connectionArn,
  appSecretArn: rds.appSecret.secretArn,  // アプリケーション用の認証情報
});

// CodeBuild　　★追加
const build = new BuildStack(app, 'BuildStack', {
  env,
  codeBuildRoleArn: iam.codeBuildRole.roleArn,               // IamStack の出力
  ecrRepoName: 'customer-info/app',
});
