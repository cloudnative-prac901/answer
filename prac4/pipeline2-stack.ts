// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as cpactions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as iam from 'aws-cdk-lib/aws-iam';

// 2. インタフェース定義
export interface Pipeline2StackProps extends cdk.StackProps {  // パイプラインスタック名の修正
  pipelineName: string;
  codeBuildRoleArn: string;     // IAMロールの参照
  codeDeployRoleArn: string;    // IAMロールの参照
  codePipelineRoleArn: string;  // IAMロールの参照

  gitHubConnectionArn: string;  // CodeConnection
  gitHubOwner: string;          // GitHubアカウント
  gitHubRepo: string;           // GitHubリポジトリ
  gitHubBranch: string;         // GtiHubブランチ

  ecrRepoName: string;          // ECRリポジトリ

  ecsAppName: string;           // ECSアプリケーション
  ecsDeploymentGroupName: string;   // ECSデプロイメントグループ
  ecsTaskExecutionRoleArn: string;  // IAMロールの参照
  ecsTaskRoleArn?: string;          // IAMロールの参照

  dbSecretArn?: string;             // RDS APPシークレット
  dbHost?: string;                  // RDS DBホスト
}

// 3. スタック初期化
export class Pipeline2Stack extends cdk.Stack {  // パイプラインスタック名の修正
  constructor(scope: Construct, id: string, props: Pipeline2StackProps) {
    super(scope, id, props);

    // 既存ロールを import
    const codeBuildRole = iam.Role.fromRoleArn(
      this, 'ImportedCodeBuildRole', props.codeBuildRoleArn, { mutable: false },
    );
    const codePipelineRole = iam.Role.fromRoleArn(
      this, 'ImportedCodePipelineRole', props.codePipelineRoleArn, { mutable: false },
    );
    // 既存 CodeBuild プロジェクト（Privileged: ON 前提）
    const buildProject = codebuild.Project.fromProjectName(
      this, 'BuildProject', 'fortune-telling-app',  // fortune-telling-appプロジェクトを指定
    );
    // 既存 CodeDeploy アプリケーション / デプロイメントグループ
    const app = codedeploy.EcsApplication.fromEcsApplicationName(
      this, 'EcsApp', props.ecsAppName,
    );
    const dg = codedeploy.EcsDeploymentGroup.fromEcsDeploymentGroupAttributes(
      this, 'EcsDG', { application: app, deploymentGroupName: props.ecsDeploymentGroupName },
    );
    // Artifacts（CDKにバケット自動作成させる：名前は自動サフィックスで変動OK）
    const sourceOutput = new codepipeline.Artifact('SourceArtifact');
    const buildOutput  = new codepipeline.Artifact('BuildArtifact');

    // 4. CodePipeline作成
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: props.pipelineName ?? 'FortuneTellingPipeline',  // パイプライン名
      role: codePipelineRole,
      stages: [

        // 5. Source: GitHub（CodeStar Connections）
        {
          stageName: 'Source',
          actions: [
            new cpactions.CodeStarConnectionsSourceAction({
              actionName: 'GitHub_Source',
              owner:  props.gitHubOwner,
              repo:   props.gitHubRepo,
              branch: props.gitHubBranch,
              connectionArn: props.gitHubConnectionArn,
              output: sourceOutput,
              triggerOnPush: true,
            }),
          ],
        },

        // 6. Build: Dockerビルド、プッシュ
        {
          stageName: 'Build',
          actions: [
            new cpactions.CodeBuildAction({
              actionName: 'Docker_Build',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput], // imageDetail.json（※buildspec側で出力）
              environmentVariables: {
                // CodeBuildに必要なら渡す
                ECR_REPO:       { value: props.ecrRepoName },
                EXEC_ROLE_ARN:  { value: props.ecsTaskExecutionRoleArn },
                TASK_ROLE_ARN:  { value: props.ecsTaskRoleArn ?? props.ecsTaskExecutionRoleArn },
                DB_HOST:        { value: props.dbHost ?? '' },
                DB_SECRET_ARN:  { value: props.dbSecretArn ?? '' },
              },
            }),
          ],
        },

        //7. Deploy: artifact置換、デプロイメント起動
        {
          stageName: 'Deploy',
          actions: [
            new cpactions.CodeDeployEcsDeployAction({
              actionName: 'ECS_BlueGreen',
              deploymentGroup: dg,
              // GitHub上に外出ししたテンプレートを参照（例：deploy/ 配下）
              appSpecTemplateFile:        sourceOutput.atPath('deploy/ecs/appspec.yml'),
              taskDefinitionTemplateFile: buildOutput.atPath('deploy/ecs/taskdef.json'),
              // Build成果物の imageDetail.json で TaskDef の <IMAGE1_NAME> を置換
              containerImageInputs: [
                {
                  input: buildOutput,
                  taskDefinitionPlaceholder: 'IMAGE1_NAME',
                },
              ],
            }),
          ],
        },
      ],
    });

    // 8. IAMロール権限追加
    // CodeDeployのIAMロールへの権限追加
    const cdRole = iam.Role.fromRoleArn(
      this, 'ImportedCodeDeployRole', props.codeDeployRoleArn, { mutable: false }
    );
    // S3 読み取り許可（アーティファクト取得用）
    pipeline.artifactBucket.grantRead(cdRole);
    // KMS 暗号化されていた場合のみ Decrypt も付与
    if (pipeline.artifactBucket.encryptionKey) {
      pipeline.artifactBucket.encryptionKey.grantDecrypt(cdRole);
    }

    // 9. 出力
    new cdk.CfnOutput(this, 'PipelineName', { value: pipeline.pipelineName });
    new cdk.CfnOutput(this, 'ArtifactBucketName', { value: pipeline.artifactBucket.bucketName });
  }
}
