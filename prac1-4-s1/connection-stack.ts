// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codestar from 'aws-cdk-lib/aws-codestarconnections';

// 2. クラス宣言、他スタックに公開するプロパティ
export class ConnectionStack extends cdk.Stack {
  public readonly connectionArn: string;

  // 3. スタック初期化
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // 4. コネクション作成
    const conn = new codestar.CfnConnection(this, 'GitHubConnection', {
      connectionName: 'CustomerInfoGitHub',
      providerType: 'GitHub',
    });
    this.connectionArn = conn.attrConnectionArn;

    // 5. 出力
    new cdk.CfnOutput(this, 'GitHubConnectionArn', {
      value: this.connectionArn,
      exportName: 'GitHubConnectionArn',
    });
  }
}
