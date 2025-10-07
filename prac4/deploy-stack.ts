// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as iam from 'aws-cdk-lib/aws-iam';

// 2. インタフェース定義
export interface DeployStackProps extends cdk.StackProps {
  clusterName: string;  // ECSクラスター名
  serviceName: string;  // ECSサービス名
  prodListenerArn: string;  // 本番リスナー
  testListenerArn: string;  // テストリスナー
  tgBlueName: string;       // ターゲットグループ(Blue)
  tgGreenName: string;      // ターゲットグループ(Green)
  codeDeployRoleArn: string;  // CodeDeploy用IAMロール
  applicationName: string;     // CodeDeploy アプリケーション名
  deploymentGroupName: string; // CodeDeploy でプロメントグループ名
}

// 3. スタック初期化
export class DeployStack extends cdk.Stack {
  public readonly application: codedeploy.CfnApplication;
  public readonly deploymentGroup: codedeploy.CfnDeploymentGroup;

  constructor(scope: Construct, id: string, props: DeployStackProps) {
    super(scope, id, props);

    // 4. CodeDeployのApplication作成
    this.application = new codedeploy.CfnApplication(this, 'EcsApplication', {
      applicationName: props.applicationName,
      computePlatform: 'ECS',
    });

    // CodeDeployサービスロールの参照
    const serviceRole = iam.Role.fromRoleArn(
      this,
      'CdServiceRole',
      props.codeDeployRoleArn,
      { mutable: false }
    );

    // 5. CodeDeployのデプロイメントグループ作成(ECS Blue/Green)
    this.deploymentGroup = new codedeploy.CfnDeploymentGroup(this, 'EcsDeploymentGroup', {
      applicationName: this.application.ref,
      deploymentGroupName: props.deploymentGroupName,
      serviceRoleArn: serviceRole.roleArn,

      // 失敗時のロールバック
      autoRollbackConfiguration: {
        enabled: true,
        events: ['DEPLOYMENT_FAILURE', 'DEPLOYMENT_STOP_ON_ALARM', 'DEPLOYMENT_STOP_ON_REQUEST'],
      },

      // 6. デプロイ方式（Blue/Green + トラフィックコントロール）
      deploymentStyle: {
        deploymentOption: 'WITH_TRAFFIC_CONTROL',
        deploymentType: 'BLUE_GREEN',
      },

      // Blue/Green の切替挙動
      blueGreenDeploymentConfiguration: {
        terminateBlueInstancesOnDeploymentSuccess: {
          action: 'TERMINATE',
          terminationWaitTimeInMinutes: 5,
        },
        deploymentReadyOption: {
          actionOnTimeout: 'STOP_DEPLOYMENT', // 承認ゲート入れない場合は CONTINUE_DEPLOYMENT
          waitTimeInMinutes: 300,                 // 承認を待つ時間
        },
        // greenFleetProvisioningOption: { action: 'DISCOVER_EXISTING' },
      },

      // 監視アラーム（必要なら enabled: true にして Alarm を渡す）
      alarmConfiguration: { enabled: false },

      // 7. ECS サービスと ALB（Listener/TG）を接続
      ecsServices: [{ clusterName: props.clusterName, serviceName: props.serviceName }],
      loadBalancerInfo: {
        targetGroupPairInfoList: [{
          prodTrafficRoute: { listenerArns: [props.prodListenerArn] },
          testTrafficRoute: { listenerArns: [props.testListenerArn] },
          targetGroups: [{ name: props.tgBlueName }, { name: props.tgGreenName }],
        }],
      },
    });

    // 8. 出力
    this.deploymentGroup.addDependency(this.application);  //依存関係の定義
    new cdk.CfnOutput(this, 'EcsAppName', { value: this.application.applicationName! });
    new cdk.CfnOutput(this, 'EcsDeploymentGroupName', { value: props.deploymentGroupName });
  }
}
