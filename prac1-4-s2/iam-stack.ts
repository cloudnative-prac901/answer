// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// 2. インタフェース定義
export interface IamStackProps extends cdk.StackProps {
  ecrRepoName: string;
  pipelineName: string;
  ghOwner: string;                 // GitHub org/user
  ghRepo: string;                  // GitHub repo
  gitHubConnectionArn?: string;    // Use CodeConnections
  appSecretArn?: string;           // アプリ用DBユーザーのSecret ARN（任意）
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
    const ecrRepoArn  = `arn:aws:ecr:${region}:${account}:repository/${props.ecrRepoName}`;
    const pipelineArn = `arn:aws:codepipeline:${region}:${account}:${props.pipelineName}`;

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
      resources: [ecrRepoArn],
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

    // 5. CodeDeployロール作成
    this.codeDeployRole = new iam.Role(this, 'CodeDeployRole', {
      assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      description: 'Allows CodeDeploy to perform ECS Blue/Green with ALB',
    });
    this.codeDeployRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeDeployRoleForECS')
    );

    // 6. ECS TaskExecutionロール作成
    this.ecsTaskExecutionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Execution role for ECS tasks to pull images & write logs',
    });
    this.ecsTaskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    // 7. ECS AppTaskロール作成
    this.appTaskRole = new iam.Role(this, 'AppTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Application task role for ECS tasks',
    });

    // 8. Secrets Manager（アプリ用シークレットリソース）
    if (props.appSecretArn) {
      const appSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'AppSecret', props.appSecretArn);
      appSecret.grantRead(this.appTaskRole); // secretsmanager:GetSecretValue など
      appSecret.grantRead(this.ecsTaskExecutionRole);
    }

    // 9. CodePipelineロール作成
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

    // 10. GitHub OIDCプロバイダー/ロール作成
    // OIDCプロバイダー作成
    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOIDC', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    // main ブランチのみ許可
    const subPattern = `repo:${props.ghOwner}/${props.ghRepo}:ref:refs/heads/main`;

    // OIDCロール作成
    this.githubOidcRole = new iam.Role(this, 'GitHubOIDCRole', {
      roleName: 'GitHubOIDCRole',
      description: 'GitHub Actions OIDC role (main branch only)',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike:   { 'token.actions.githubusercontent.com:sub': subPattern }
      }),
    });

    // Pipeline
    this.githubOidcRole.addToPolicy(new iam.PolicyStatement({
      actions: ['codepipeline:StartPipelineExecution'],
      resources: [pipelineArn],
    }));

    // 11. 出力
    new cdk.CfnOutput(this, 'CodeBuildRoleArn',        { value: this.codeBuildRole.roleArn });
    new cdk.CfnOutput(this, 'CodeDeployRoleArn',       { value: this.codeDeployRole.roleArn });
    new cdk.CfnOutput(this, 'CodePipelineRoleArn',     { value: this.codePipelineRole.roleArn });
    new cdk.CfnOutput(this, 'ECSTaskExecutionRoleArn', { value: this.ecsTaskExecutionRole.roleArn });
    new cdk.CfnOutput(this, 'AppTaskRoleArn',          { value: this.appTaskRole.roleArn });
    new cdk.CfnOutput(this, 'GitHubOIDCRoleArn',       { value: this.githubOidcRole.roleArn });
    new cdk.CfnOutput(this, 'GitHubOIDCRoleName',      { value: this.githubOidcRole.roleName });
    new cdk.CfnOutput(this, 'TargetPipelineArn',       { value: pipelineArn });
    new cdk.CfnOutput(this, 'TargetEcrRepoArn',        { value: ecrRepoArn });
  }
}
