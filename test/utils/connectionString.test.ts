import { parseConnectionString } from '../../src/utils/connectionString';

describe('parseConnectionString', () => {
  it.each([
    ['server.example.com', { username: '', hostname: 'server.example.com', port: 22 }],
    ['pau@server.example.com', { username: 'pau', hostname: 'server.example.com', port: 22 }],
    ['pau@10.0.0.5:2222', { username: 'pau', hostname: '10.0.0.5', port: 2222 }],
    ['10.0.0.5:2222', { username: '', hostname: '10.0.0.5', port: 2222 }],
    ['  pau@host  ', { username: 'pau', hostname: 'host', port: 22 }],
  ])('parses %s', (input, expected) => {
    expect(parseConnectionString(input)).toEqual(expected);
  });

  it('treats a bare IPv6 literal as a host, not a host:port', () => {
    expect(parseConnectionString('2001:db8::1')).toEqual({
      username: '',
      hostname: '2001:db8::1',
      port: 22,
    });
  });

  it('reads the port from a bracketed IPv6 address', () => {
    expect(parseConnectionString('pau@[2001:db8::1]:2222')).toEqual({
      username: 'pau',
      hostname: '2001:db8::1',
      port: 2222,
    });
  });

  it('accepts a bracketed IPv6 address without a port', () => {
    expect(parseConnectionString('[::1]')).toEqual({ username: '', hostname: '::1', port: 22 });
  });

  it('splits on the last @ so an address in the user part does not confuse it', () => {
    expect(parseConnectionString('pau@work.com@bastion.example.com')).toEqual({
      username: 'pau@work.com',
      hostname: 'bastion.example.com',
      port: 22,
    });
  });

  it.each([
    ['', /Enter a destination/],
    ['pau@', /Missing hostname/],
    ['host:notaport', /Invalid port/],
    ['host:0', /Invalid port/],
    ['host:70000', /Invalid port/],
    ['[::1', /Unbalanced brackets/],
  ])('rejects %s', (input, pattern) => {
    expect(() => parseConnectionString(input)).toThrow(pattern);
  });
});
