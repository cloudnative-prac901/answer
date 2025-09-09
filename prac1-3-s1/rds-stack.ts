// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// 2. インタフェース定義
export interface RdsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  dbSg: ec2.ISecurityGroup;
}

// 3. スタック初期化
export class RdsStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    // 4. シークレット作成（DBパスワードをSecrets Managerで管理）
    this.dbSecret = new rds.DatabaseSecret(this, 'CustomerInfoDbSecret', {
      secretName: 'customer-info-db-credentials',
      username: 'admin',
    });

    // 5. RDS MySQLインスタンス作成
    this.dbInstance = new rds.DatabaseInstance(this, 'CustomerInfoDb', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_42,
      }),
      instanceIdentifier: 'customer-info-db',      // ★RDS インスタンス名
      vpc: props.vpc,
      vpcSubnets: { subnetGroupName: 'db-private' },
      instanceType: new ec2.InstanceType(process.env.DB_INSTANCE_TYPE ?? 't3.micro'),
      securityGroups: [props.dbSg],
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      multiAz: false,
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      databaseName: 'customer_info',              // ★初期DB名
    });

    // 6. 出力
    new cdk.CfnOutput(this, 'CustomerInfoDbEndpoint', {
      value: this.dbInstance.dbInstanceEndpointAddress,
    });
    new cdk.CfnOutput(this, 'CustomerInfoDbSecretName', {
      value: this.dbSecret.secretName,
    });
  }
}
