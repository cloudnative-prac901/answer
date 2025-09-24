// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Token } from 'aws-cdk-lib'; // Token 判定に使用

// 2. インタフェース定義
export interface BuildStackProps extends cdk.StackProps {
  codeBuildRoleArn: string;         // CodeBuildRoleのARN
  ecrRepoName?: string;             // ECRリポジトリ名
  buildSpecFile?: string;           // buildspec.ymlのパス
  testBuildSpecFile?: string;       // buildspec.test.ymlのパス ★追加
}

// 3. スタック初期化
export class BuildStack extends cdk.Stack {
  public readonly project: codebuild.IProject;
  public readonly projectName: string;
  public readonly testProject: codebuild.IProject;  // ★テスト用CodeBuild参照
  public readonly testProjectName: string;          // ★テスト用CodeBuild名

  constructor(scope: Construct, id: string, props: BuildStackProps) {
    super(scope, id, props);

    // デプロイ先のアカウント、リージョンのセット
    const account = cdk.Stack.of(this).account;
    const region  = cdk.Stack.of(this).region;

    // 4. IAMロールARNの形式確認
    const arnRegex = /^arn:aws:iam::\d{12}:role\/.+$/;
    const validateArnIfLiteral = (label: string, value: string) => {
      if (!Token.isUnresolved(value) && !arnRegex.test(value)) {
        throw new Error(`${label} is invalid: ${value}`);
      }
    };
    validateArnIfLiteral('codeBuildRoleArn', props.codeBuildRoleArn);

    // 5. ECRリポジトリの設定
    const repoName    = props.ecrRepoName ?? 'customer-info/app';
    const ecrRegistry = `${account}.dkr.ecr.${region}.amazonaws.com`;

    // 6. CodeBuildRoleのインポート
    const role = iam.Role.fromRoleArn(this, 'ImportedCodeBuildRole', props.codeBuildRoleArn, {
      mutable: false,
    });

    // 7. CodeBuildプロジェクトの作成（CodePipelineから起動）
    const project = new codebuild.PipelineProject(this, 'Project', {
      projectName: 'customer-info-app',
      role,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true, // Docker build/pushを行うための必須設定
      },

      // リポジトリ直下の buildspec.yml を利用
      buildSpec: codebuild.BuildSpec.fromSourceFilename(props.buildSpecFile ?? 'buildspec.yml'),

      // buildspec から参照する環境変数
      environmentVariables: {
        ECR_REPO:       { value: repoName },  // ECRのリポジトリ名
        AWS_ACCOUNT_ID: { value: account },
        AWS_REGION:     { value: region  },
      },
    });

    // 8. test用CodeBuildプロジェクトの作成（CodePipelineから起動）  ★追加
    const testProject = new codebuild.PipelineProject(this, 'UnitTestProject', {
      projectName: 'customer-info-tests',   // 任意の分かりやすい名前
      role,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, // Pythonツール入りイメージ
        privileged: false,                                  // pytest だけなので特権不要
      },

      // リポジトリ直下の buildspec.test.yml を利用
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        props.testBuildSpecFile ?? 'buildspec.test.yml',
      ),
    });

    this.project = project;
    this.projectName = project.projectName;
    this.testProject = testProject;                  // ★追加
    this.testProjectName = testProject.projectName;  // ★追加

    // 9. 出力
    new cdk.CfnOutput(this, 'CodeBuildProjectName',     { value: project.projectName     });
    new cdk.CfnOutput(this, 'CodeBuildProjectArn',      { value: project.projectArn      });
    new cdk.CfnOutput(this, 'TestCodeBuildProjectName', { value: testProject.projectName });  // ★追加
    new cdk.CfnOutput(this, 'TestCodeBuildProjectArn',  { value: testProject.projectArn  });  // ★追加
    new cdk.CfnOutput(this, 'EcrRepoName',              { value: repoName                });
    new cdk.CfnOutput(this, 'EcrRegistry',              { value: ecrRegistry             });
  }
}
