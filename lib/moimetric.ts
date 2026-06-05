import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Webapp } from './constructs/Webapp.ts';

type MoimetricStackProps = cdk.StackProps & {
  appStage: string;
};

export class MoimetricStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MoimetricStackProps) {
    super(scope, id, props);

    new Webapp(this, 'Webapp', { appStage: props.appStage });
  }
}
