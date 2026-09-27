export function channelPatch(name: string, description: string): { name: string; description: string } {
  const cleaned = name.trim();
  if (!cleaned) throw new Error('Enter a channel name.');
  if (cleaned.length > 200) throw new Error('The channel name is too long.');
  return { name: cleaned, description: description.trim() };
}
export function threadPatch(title: string): { title: string } {
  const cleaned = title.trim();
  if (!cleaned) throw new Error('Enter a conversation name.');
  if (cleaned.length > 200) throw new Error('The conversation name is too long.');
  return { title: cleaned };
}
