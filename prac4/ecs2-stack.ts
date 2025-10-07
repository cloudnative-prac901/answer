// 1. インポート
import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs  from 'aws-cdk-lib/aws-ecs';
import * as ec2  from 'aws-cdk-lib/aws-ec2';
import * as iam  from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cw  from 'aws-cdk-lib/aws-cloudwatch';

// 2. インタフェース定義
export interface Ecs2StackProps extends StackProps {
  vpc         : ec2.IVpc;
  ecsSg       : ec2.ISecurityGroup;
  repo        : ecr.IRepository;
  targetGroup : elbv2.ApplicationTargetGroup;
}

// 3. スタック初期化
export class Ecs2Stack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: Ecs2StackProps) {
    super(scope, id, props);

    // 4. ECSクラスタ作成（FortuneTelling用クラスタ）
    this.cluster = new ecs.Cluster(this, 'AppCluster', {
      vpc: props.vpc,
      clusterName: 'fortune-telling-cluster',
      containerInsights: true,
    });

    // 5. IAMロール設定
    const execRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    
    execRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: ['*'],
    }));

    const taskRole = new iam.Role(this, 'AppTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // 6. タスク定義
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole: execRole,
      taskRole: taskRole,
      family: 'fortune-telling-task',
    });

    taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.repo, 'v0.2.2'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'fortune-telling',
      }),
      portMappings: [{ containerPort: 80 }],

      // ヘルスチェック（80番ポートがLISTEN中かを /proc で判定）
      healthCheck: {
        command: [
          'CMD-SHELL',
          "awk 'NR>1 && $2 ~ /:0050$/ && $4==\"0A\"{f=1} END{exit f?0:1}' /proc/net/tcp"
        ],
        interval: Duration.seconds(30),
        timeout : Duration.seconds(5),
        retries : 3,
        startPeriod: Duration.seconds(60),
      },
      environment: {
        ENVIRONMENT: 'production',
        APP_NAME: 'fortune-telling',
      },
    });

    // 7. サービス定義
    this.service = new ecs.FargateService(this, 'AppService', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      serviceName: 'fortune-telling-service',
      securityGroups: [props.ecsSg],
      vpcSubnets: props.vpc.selectSubnets({ subnetGroupName: 'ecs-private' }),
      enableExecuteCommand: true,
      healthCheckGracePeriod: Duration.seconds(60),
      deploymentController: { type: ecs.DeploymentControllerType.CODE_DEPLOY },
    });

    // 8. ALBターゲットグループ登録
    this.service.attachToApplicationTargetGroup(props.targetGroup);

    // 9. オートスケール設定（任意）
    const scalable = this.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 4 });

    // 9-1 CPU 50% でターゲット追跡
    scalable.scaleOnCpuUtilization('Cpu50', {
      targetUtilizationPercent: 50,
      scaleInCooldown : Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // 9-2 ALB リクエスト 100 req/tgt/sec
    scalable.scaleOnRequestCount('Req100', {
      requestsPerTarget: 100,
      targetGroup: props.targetGroup,
      scaleInCooldown : Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // 10. 出力
    new CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn });
    new CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new CfnOutput(this, 'TaskFamily',  { value: taskDef.family });
  }
}
