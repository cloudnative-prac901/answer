// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

// 2. スタック初期化
export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 3. リポジトリ作成
    this.repository = new ecr.Repository(this,'CustomerInfoAppRepo',{
        repositoryName : 'customer-info/app', // 作成するリポジトリ名
        imageScanOnPush: true,                // 自動スキャン
        removalPolicy  : cdk.RemovalPolicy.RETAIN, // 誤削除防止
      },
    );

    // 4. ライフサイクル
    this.repository.addLifecycleRule({
      description : 'Delete images older than 7 days',
      maxImageAge : cdk.Duration.days(7),
      tagStatus   : ecr.TagStatus.ANY,
    });

    // 5. 出力
    new cdk.CfnOutput(this, 'CustomerInfoAppRepoUri',{
      value      : this.repository.repositoryUri,
      description: 'ECR repository URI for customer-info/app',
      exportName : 'customerInfoAppRepoUri',
    });
  }
}
