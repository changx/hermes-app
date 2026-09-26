export function channelPatch(name: string, description: string): { name: string; description: string } {
  const cleaned = name.trim();
  if (!cleaned) throw new Error('请输入频道名称');
  if (cleaned.length > 200) throw new Error('频道名称过长');
  return { name: cleaned, description: description.trim() };
}
export function threadPatch(title: string): { title: string } {
  const cleaned = title.trim();
  if (!cleaned) throw new Error('请输入话题名称');
  if (cleaned.length > 200) throw new Error('话题名称过长');
  return { title: cleaned };
}
