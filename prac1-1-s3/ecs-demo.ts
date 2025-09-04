#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { NetStack } from '../lib/net-stack';
import { VpceStack } from '../lib/vpce-stack';
import { AlbStack } from '../lib/alb-stack';    // ★追加
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
});

// ALB / WAF　★追加
const alb = new AlbStack(app, 'AlbStack', {
  env,
  vpc: net.vpc,
  albSg: net.albSg,
});
