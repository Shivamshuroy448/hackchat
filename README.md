# HackChat — team chatbox for hackathons

share code and files with your hackathon team. everyone with the same
team code sees the same room. no accounts, no login.

- text chat
- code snippets with syntax highlighting, language picker, copy button
- file uploads with downloads (code, images, docs, anything under 4 MB)
- member list, timestamps, auto-refresh every 2 seconds

## run it

```
npm install
npm run dev
```

open http://localhost:3000, enter a team code and a name.

## deploy it on vercel

1. push this folder to a github repo (or `npx vercel` from this folder).
2. import the repo in vercel.
3. in the vercel dashboard, storage -> create database -> KV, and connect
   it to this project. storage -> create -> Blob, and connect it too.
   vercel adds KV_REST_API_URL, KV_REST_API_TOKEN and
   BLOB_READ_WRITE_TOKEN for you. redeploy.
4. share the url. teammates open it, type the same team code, done.

room link: anyone can copy a link with the team code in it
(`https://your-app.vercel.app/?room=KESSLER`) and joining prefills it.

## without kv / blob (demo mode)

the app still builds and runs with no env vars at all. messages and
files live in server memory only: they vanish on redeploy and do not
sync across serverless instances. fine for a quick local demo, not
for a real team. connect KV + Blob for the real thing.

## notes

- team code is the only key. anyone with the code can read and post
  in that room. pick a code your team only knows.
- files are capped at 4 MB (vercel serverless body limit). without a
  blob store, files are capped at 1 MB and stored with the room data.
- messages are capped at 500 per room, files at 100 per room.
