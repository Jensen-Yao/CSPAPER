import net from 'node:net'
import dns from 'node:dns/promises'

/** Shared outbound guard: only public HTTPS hosts, never private or loopback ranges, verified per redirect hop. */
export type ResolveHostLike=(hostname:string)=>Promise<string[]>

const blockedIps=new net.BlockList()
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as Array<[string,number]>)blockedIps.addSubnet(address,prefix)
blockedIps.addAddress('::1','ipv6')
blockedIps.addSubnet('fc00::',7,'ipv6')
blockedIps.addSubnet('fe80::',10,'ipv6')

export function isBlockedIp(rawIp:string):boolean {
  const ip=rawIp.toLowerCase().replace(/^\[|\]$/g,'')
  if(ip==='::')return true
  const mapped=ip.startsWith('::ffff:')&&net.isIPv4(ip.slice(7))?ip.slice(7):ip
  return blockedIps.check(mapped,net.isIPv6(mapped)?'ipv6':'ipv4')
}

/** Accept only absolute HTTPS URLs without credentials and without private literal hosts. http:// is upgraded to https://. */
export function safePublicHttpsUrl(raw:string):string|null {
  try {
    let url=new URL(raw.trim())
    if(url.protocol==='http:')url=new URL(raw.trim().replace(/^http:\/\//i,'https://'))
    if(url.protocol!=='https:'||url.username||url.password)return null
    const bare=url.hostname.replace(/^\[|\]$/g,'')
    if(net.isIP(bare)&&isBlockedIp(bare))return null
    const host=bare.toLowerCase()
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.home'))return null
    return url.toString()
  } catch {
    return null
  }
}

export const resolveHost:ResolveHostLike=async hostname=>(await dns.lookup(hostname,{all:true,verbatim:true})).map(item=>item.address)

export async function assertPublicHost(hostname:string,resolver:ResolveHostLike=resolveHost):Promise<void> {
  const bare=hostname.replace(/^\[|\]$/g,'')
  if(net.isIP(bare)) {
    if(isBlockedIp(bare))throw new Error('地址解析到内网/本机地址，已拒绝访问')
    return
  }
  const addresses=await resolver(bare)
  if(!addresses.length)throw new Error('域名没有可解析地址，已拒绝访问')
  if(addresses.some(address=>isBlockedIp(address)))throw new Error('域名解析到内网/本机地址，已拒绝访问')
}

/** Resolve a redirect target against the current URL and validate it before following. */
export function redirectTarget(currentUrl:string,location:string):string|null {
  try {
    const next=new URL(location,currentUrl).toString()
    return safePublicHttpsUrl(next)
  } catch {
    return null
  }
}
