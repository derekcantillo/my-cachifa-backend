export class WebhookVerifyDto {
  hub_mode!: string;
  hub_verify_token!: string;
  hub_challenge!: string;
}
