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
export interface EcsStackProps extends StackProps {
  vpc         : ec2.IVpc;
  ecsSg       : ec2.ISecurityGroup;
  repo        : ecr.IRepository;
  targetGroup : elbv2.ApplicationTargetGroup;
}

// 3. スタック初期化
export class EcsStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // 4. ECSクラスタ作成
    this.cluster = new ecs.Cluster(this, 'AppCluster', {
      vpc: props.vpc,
      clusterName: 'ecs-app-cluster',
      containerInsights: true,
    });

    // 5. IAMロール設定
    const execRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskRole = new iam.Role(this, 'AppTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // 6. Cloudwatchロググループ設定
    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      logGroupName: '/ecs/customer-info',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // 7. タスク定義
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole: execRole,
      taskRole: taskRole,
      family: 'customer-info-task',
    });

    taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.repo, 'v0.1.1'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'customer-info',
        logGroup,
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
        APP_NAME: 'customer-info',
      },
    });

    // 8. サービス定義
    this.service = new ecs.FargateService(this, 'AppService', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      serviceName: 'customer-info-service',
      securityGroups: [props.ecsSg],
      vpcSubnets: props.vpc.selectSubnets({ subnetGroupName: 'ecs-private' }),
      enableExecuteCommand: true,
      healthCheckGracePeriod: Duration.seconds(60),
    });

    // 9. ALBターゲットグループ登録
    this.service.attachToApplicationTargetGroup(props.targetGroup);

    // 10. オートスケール設定（任意）
    const scalable = this.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 4 });

    // 10-1 CPU 50% でターゲット追跡
    scalable.scaleOnCpuUtilization('Cpu50', {
      targetUtilizationPercent: 50,
      scaleInCooldown : Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // 10-2 ALB リクエスト 100 req/tgt/sec
    scalable.scaleOnRequestCount('Req100', {
      requestsPerTarget: 100,
      targetGroup: props.targetGroup,
      scaleInCooldown : Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // 11. 出力
    new CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn });
    new CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new CfnOutput(this, 'TaskFamily',  { value: taskDef.family });
  }
}
