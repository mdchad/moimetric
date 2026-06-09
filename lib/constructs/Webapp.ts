// oxlint-disable max-statements
import { Construct } from 'constructs';
import { WebappApi } from './WebappApi.ts';
import { WebappAssetsBucket } from './WebappAssetsBucket.ts';
import { WebappAssetsDeployment } from './WebappAssetsDeployment.ts';
import { WebappDistribution } from './WebappDistribution.ts';
import { WebappFunctionUrl } from './WebappFunctionUrl.ts';
import { WebappServer } from './WebappServer.ts';

type WebappProps = {
  appStage: string;
};

export class Webapp extends Construct {
  constructor(scope: Construct, id: string, props: WebappProps) {
    super(scope, id);

    // Data lives in Turso (libSQL); the server reads its credentials from the
    // per-stage Secrets Manager secret wired in WebappServer. Metric ingestion
    // (EventBridge + SQS worker) is a separate construct added in a later phase.
    const webappServer = new WebappServer(this, 'WebappServer', {
      appStage: props.appStage,
    });

    const webappServerFunctionUrl = new WebappFunctionUrl(this, 'WebappServerFunctionUrl', {
      webappServer: webappServer.webappServer,
    });

    const webappApi = new WebappApi(this, 'WebappApi', {
      webappServer: webappServer.webappServer,
    });

    const assetsBucket = new WebappAssetsBucket(this, 'WebappAssetsBucket');

    const distributionApiGw = new WebappDistribution(this, 'WebappDistributionApiGw', {
      appStage: props.appStage,
      assetsBucket: assetsBucket.assetsBucket,
      originBehaviorKind: 'apiGw',
      webappServerApi: webappApi.webappApi,
      webappServerFunctionUrl: webappServerFunctionUrl.webappServerFunctionUrl,
    });

    new WebappAssetsDeployment(this, 'WebappAssetsDeploymentApiGw', {
      assetsBucket: assetsBucket.assetsBucket,
      distribution: distributionApiGw.distribution,
    });
  }
}
