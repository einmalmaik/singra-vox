import urllib.request
import json
import urllib.error

try:
    req = urllib.request.Request('http://localhost:8080/api/auth/login', data=json.dumps({'email':'admin@singravox.local', 'password':'Password123!'}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    res = urllib.request.urlopen(req)
    cookie = res.headers.get('Set-Cookie')

    req = urllib.request.Request('http://localhost:8080/api/servers', headers={'Cookie': cookie})
    servers = json.loads(urllib.request.urlopen(req).read().decode())
    sid = servers[0]['id']

    req = urllib.request.Request(f'http://localhost:8080/api/servers/{sid}/channels', headers={'Cookie': cookie})
    ch = json.loads(urllib.request.urlopen(req).read().decode())
    print('CHANNELS:', len(ch), ch)

    req = urllib.request.Request(f'http://localhost:8080/api/servers/{sid}/members', headers={'Cookie': cookie})
    mem = json.loads(urllib.request.urlopen(req).read().decode())
    print('MEMBERS:', len(mem))
except Exception as e:
    print(e)
