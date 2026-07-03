from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from crossclipper.auth.service import authenticate_token

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(...)) -> None:
    with Session(websocket.app.state.engine) as session:
        ctx = authenticate_token(session, token)
        session.commit()  # persists last_seen_at touch
    if ctx is None:
        await websocket.close(code=4401)
        return

    hub = websocket.app.state.hub
    await websocket.accept()
    hub.add(ctx.user_id, websocket)
    try:
        while True:
            msg = await websocket.receive_json()
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(ctx.user_id, websocket)
