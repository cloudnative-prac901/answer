// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

// 2. スタック初期化
export class EcrStack extends cdk.Stack {
  // public readonly repository: ecr.Repository;  ★コメントアウト
  public readonly customerInfoRepo: ecr.Repository;    // ★顧客情報表示機能用
  public readonly fortuneTellingRepo: ecr.Repository;  // ★占い機能用

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 3. CustomerInfoApp リポジトリ作成
    this.customerInfoRepo = new ecr.Repository(this, 'CustomerInfoAppRepo', {  // ★変数名を修正
      repositoryName : 'customer-info/app',       // 作成するリポジトリ名
      imageScanOnPush: true,                      // 自動スキャン
      removalPolicy  : cdk.RemovalPolicy.RETAIN,  // 誤削除防止
    });

    // 4. FortuneTellingApp リポジトリ作成　★セクション追加
    this.fortuneTellingRepo = new ecr.Repository(this, 'FortuneTellingAppRepo', {
      repositoryName : 'fortune-telling/app',
      imageScanOnPush: true,
      removalPolicy  : cdk.RemovalPolicy.RETAIN,
    });

    // 5. ライフサイクルルール
    // ★2リポジトリにまとめて設定するためにコードを修正
    const lifecycleRule = {
      description : 'Delete images older than 7 days',
      maxImageAge : cdk.Duration.days(7),
      tagStatus   : ecr.TagStatus.ANY,
    };
    this.customerInfoRepo.addLifecycleRule(lifecycleRule);    // 既存アプリ
    this.fortuneTellingRepo.addLifecycleRule(lifecycleRule);  // 新規アプリ

    // 6. 出力
    new cdk.CfnOutput(this, 'CustomerInfoAppRepoUri', {  // ★変数名を修正
      value      : this.customerInfoRepo.repositoryUri,
      description: 'ECR repository URI for customer-info/app',
      exportName : 'customerInfoAppRepoUri',
    });
    // ★新規アプリケーションの出力設定
    new cdk.CfnOutput(this, 'FortuneTellingAppRepoUri', {
      value      : this.fortuneTellingRepo.repositoryUri,
      description: 'ECR repository URI for fortune-telling/app',
      exportName : 'fortuneTellingAppRepoUri',
    });
  }
}
