export const HELP_FEEDBACK_COMMUNITY_URL = 'https://github.com/lsdefine/GenericAgent#-社区与支持';
export const HELP_FEEDBACK_TUTORIAL_URL = 'https://datawhalechina.github.io/hello-generic-agent/';

export const HELP_FEEDBACK_WECHAT_IDS = [
  'RoundSquisheen',
  '_Ashes_in_the_Snow_',
  'pax1123581321',
] as const;

export async function copyHelpFeedbackWechatId(
  wechatId: string,
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
): Promise<void> {
  await writeText(wechatId);
}
