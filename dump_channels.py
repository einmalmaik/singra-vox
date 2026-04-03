import json
import pymongo
from bson import json_util

c = pymongo.MongoClient('mongodb://mongodb:27017')
db = c.singravox_v1_e2e
server = db.servers.find_one()
channels = list(db.channels.find({'server_id': server['id']}, {'_id': 0}))

with open('/app/tmp_channels.json', 'w') as f:
    json.dump(channels, f, default=json_util.default)
