export const HELP_FEEDBACK_WECHAT_IDS = ['RoundSquisheen', '_Ashes_in_the_Snow_'] as const;

export async function copyHelpFeedbackWechatId(
  wechatId: string,
  writeText: (text: string) => Promise<void> = (text) => navigator.clipboard.writeText(text),
): Promise<void> {
  await writeText(wechatId);
}
