import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codestar from 'aws-cdk-lib/aws-codestarconnections';

export class ConnectionStack extends cdk.Stack {
  public readonly connectionArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const conn = new codestar.CfnConnection(this, 'GitHubConnection', {
      connectionName: 'CustomerInfoGitHub',
      providerType: 'GitHub',
    });

    this.connectionArn = conn.attrConnectionArn;

    new cdk.CfnOutput(this, 'GitHubConnectionArn', {
      value: this.connectionArn,
      exportName: 'GitHubConnectionArn',
    });
  }
}
