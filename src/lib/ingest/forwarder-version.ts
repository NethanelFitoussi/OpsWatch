/**
 * The forwarder this instance ships.
 *
 * It is in the CloudFormation template, in the Lambda's own environment, in every request the forwarder
 * makes and in every answer OpsWatch gives — so an operator can be told their forwarder is behind without
 * OpsWatch having to guess, and so an upgrade is a stack update rather than a reconnection.
 *
 * Semantic: a change to what the forwarder *sends* is a major; a change to how it sends it is a minor.
 */
export const FORWARDER_VERSION = '1.0.0';
