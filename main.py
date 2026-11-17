from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api")
def api_root():
    return {"message": "Hello from ninjavan-nm"}
