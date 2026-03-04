export const isLocalhost = (ip: string): boolean => {
  return ip === '127.0.0.1' || ip === 'localhost' || ip === '::1' || ip === '::ffff:127.0.0.1';
};
