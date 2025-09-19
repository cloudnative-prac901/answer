// 1. インポート
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';

// 2. インタフェース定義
export interface AcmStackProps extends cdk.StackProps {
  domainName: string;        // 例: app.test-jp.com
  hostedZoneName: string;    // 例: test-jp.com
}

// 3. クラス初期化
export class AcmStack extends cdk.Stack {
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: AcmStackProps) {
    super(scope, id, props);

    // 4. HostedZoneをlookup
    const zone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.hostedZoneName,
    });

    // 5. 証明書作成
    const cert = new acm.Certificate(this, 'AlbCert', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    this.certificateArn = cert.certificateArn;
  }
}
