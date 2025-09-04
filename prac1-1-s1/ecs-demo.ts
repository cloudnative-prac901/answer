#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { NetStack } from '../lib/net-stack';

// CDKの初期化、デプロイ環境の設定
const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region : process.env.CDK_DEFAULT_REGION,
};

// VPC / Subnets / SecurityGroups
const net = new NetStack(app, 'NetStack', { env });
