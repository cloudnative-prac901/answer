// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// 2. インタフェース定義
// ★外部から受け取るパラメータを配列で渡す仕様に変更
// ★受け取るパラメータを倍に増やして良い（例：ecrRepoName/ecrRepoName2）
export interface IamStackProps extends cdk.StackProps {
  ecrRepoNames: string[];      // ['customer-info/app', 'fortune-telling/app']
  pipelineNames: string[];     // ['CustomerInfoPipeline', 'FortuneTellingPipeline']
  ghRepos: Array<{ owner: string; repo: string; branches?: string[] }>;
  gitHubConnectionArn?: string;
  appSecretArns: string[];     // ['arn:aws:secretsmanager:...:customer-info', 'arn:aws:secretsmanager:...:fortune-telling']
}

// 3. スタック初期化
export class IamStack extends cdk.Stack {
  public readonly codeBuildRole: iam.Role;
  public readonly codeDeployRole: iam.Role;
  public readonly codePipelineRole: iam.Role;
  public readonly ecsTaskExecutionRole: iam.Role;
  public readonly appTaskRole: iam.Role;
  public readonly githubOidcRole: iam.Role;

  constructor(scope: Construct, id: string, props: IamStackProps) {
    super(scope, id, props);

    const { account, region } = cdk.Stack.of(this);

    // ★ARNを配列で生成するよう処理を変更
    const ecrRepoArns = props.ecrRepoNames.map(
      name => `arn:aws:ecr:${region}:${account}:repository/${name}`
    );
    const pipelineArns = props.pipelineNames.map(
      name => `arn:aws:codepipeline:${region}:${account}:${name}`
    );

    // 4. CodeBuildロール作成
    this.codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Allows CodeBuild to push images to ECR and write logs',
    });
    // CloudWatchLogs
    this.codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents'],
      resources: ['*'],
    }));
    // ECR
    this.codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));
    this.codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability','ecr:InitiateLayerUpload','ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload','ecr:PutImage','ecr:BatchGetImage','ecr:GetDownloadUrlForLayer',
      ],
      resources: ecrRepoArns,  //★リポジトリARN配列を対象リソースに指定
    }));
    // Artifact S3/KMS
    this.codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject','s3:PutObject','s3:GetBucketLocation','s3:ListBucket'],
      resources: ['*'],
    }));
    this.codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt','kms:Encrypt','kms:GenerateDataKey*','kms:DescribeKey'],
      resources: ['*'],
    }));

    // CodeBuild Reports（pytestのJUnit等をレポートとして登録）
    this.codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'codebuild:*Report*',   // Create/Update/Delete/List/Describe(Reports/ReportGroups) まとめて許可
        'codebuild:BatchPut*',  // BatchPutTestCases / BatchPutCodeCoverages など
      ],
      resources: ['*'],
    }));

    // 5. CodeDeployロール作成
    this.codeDeployRole = new iam.Role(this, 'CodeDeployRole', {
      assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      description: 'Allows CodeDeploy to perform ECS Blue/Green with ALB',
    });
    this.codeDeployRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECS')
    );

    // 6. ECS TaskExecutionロール
    this.ecsTaskExecutionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Execution role for ECS tasks',
    });
    this.ecsTaskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    // 7. AppTaskロール
    this.appTaskRole = new iam.Role(this, 'AppTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Application task role for ECS tasks',
    });

    // 8. Secrets Manager（アプリ単位）
    // ★シークレットARNを配列にし、アプリケーション単位でシークレットの操作権限を付与
    if (props.appSecretArns?.length) {
      props.appSecretArns.forEach((arn, idx) => {
        const secret = secretsmanager.Secret.fromSecretCompleteArn(this, `AppSecret${idx}`, arn);
        secret.grantRead(this.appTaskRole);
        secret.grantRead(this.ecsTaskExecutionRole);
      });
    }

    // 9. CodePipelineロール
    this.codePipelineRole = new iam.Role(this, 'CodePipelineRole', {
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'Allows CodePipeline to orchestrate Source/Build/Deploy',
    });
    this.codePipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ['codebuild:StartBuild','codebuild:BatchGetBuilds'],
      resources: ['*'],
    }));
    this.codePipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ['codedeploy:CreateDeployment','codedeploy:Get*','codedeploy:RegisterApplicationRevision'],
      resources: ['*'],
    }));
    // Artifact S3/KMS
    this.codePipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject','s3:PutObject','s3:GetBucketLocation','s3:ListBucket'],
      resources: ['*'],
    }));
    this.codePipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt','kms:Encrypt','kms:GenerateDataKey*','kms:DescribeKey'],
      resources: ['*'],
    }));
    // PassRole を委譲先サービスに限定
    this.codePipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [this.codeBuildRole.roleArn, this.codeDeployRole.roleArn],
      conditions: { StringEquals: { 'iam:PassedToService': ['codebuild.amazonaws.com','codedeploy.amazonaws.com'] } }
    }));
    // CodeConnection
    if (props.gitHubConnectionArn) {
      this.codePipelineRole.addToPolicy(new iam.PolicyStatement({
        actions: ['codestar-connections:UseConnection','codeconnections:UseConnection'],
        resources: [props.gitHubConnectionArn],
      }));
    }

    // 10. GitHub OIDCプロバイダー
    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOIDC', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // ★複数リポジトリ/ブランチを許可できるように変更
    const subPatterns = props.ghRepos.flatMap(r => {
      const branches = r.branches && r.branches.length ? r.branches : ['main'];
      return branches.map(b => `repo:${r.owner}/${r.repo}:ref:refs/heads/${b}`);
    });

    this.githubOidcRole = new iam.Role(this, 'GitHubOIDCRole', {
      roleName: 'GitHubOIDCRole',
      description: 'GitHub Actions OIDC role for multiple repos',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': subPatterns },  // 複数リポジトリに対応
      }),
    });

    // 各Pipelineを実行可能にする
    this.githubOidcRole.addToPolicy(new iam.PolicyStatement({
      actions: ['codepipeline:StartPipelineExecution'],
      resources: pipelineArns,  //★パイプラインARN配列を対象リソースに指定
    }));

    // 11. 出力
    new cdk.CfnOutput(this, 'CodeBuildRoleArn',        { value: this.codeBuildRole.roleArn });
    new cdk.CfnOutput(this, 'CodeDeployRoleArn',       { value: this.codeDeployRole.roleArn });
    new cdk.CfnOutput(this, 'CodePipelineRoleArn',     { value: this.codePipelineRole.roleArn });
    new cdk.CfnOutput(this, 'ECSTaskExecutionRoleArn', { value: this.ecsTaskExecutionRole.roleArn });
    new cdk.CfnOutput(this, 'AppTaskRoleArn',          { value: this.appTaskRole.roleArn });
    new cdk.CfnOutput(this, 'GitHubOIDCRoleArn',       { value: this.githubOidcRole.roleArn });
    new cdk.CfnOutput(this, 'TargetPipelineArns',      { value: pipelineArns.join(',') });  // ★配列に変更
    new cdk.CfnOutput(this, 'TargetEcrRepoArns',       { value: ecrRepoArns.join(',') });   // ★配列に変更
    new cdk.CfnOutput(this, 'TargetAppSecretArns',     { value: props.appSecretArns.join(',') });
  }
}
