"""Disposable P0 dashboard API plugin. Synthetic-only, NOT an App backend.

Loaded by the real dashboard manifest/allow-list importer, never imported directly by
probe.py. Environment paths are mandatory to avoid accidental access to a real store.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from hermes_cli import projects_db
from hermes_state import SessionDB
from tui_gateway.server import _history_to_messages
from gateway import hosted_rooms

router = APIRouter()


def path(name: str) -> Path:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"probe-only path {name} missing")
    return Path(value)


class Channel(BaseModel):
    name: str
    description: str


class Send(BaseModel):
    send_id: str
    text: str


class Read(BaseModel):
    cursor: int


@router.post('/channels')
def create_channel(body: Channel):
    with projects_db.connect_closing(path('P0_PROJECT_DB')) as conn:
        pid = projects_db.create_project(conn, name=body.name, description=body.description)
        return projects_db.get_project(conn, pid).to_dict()


@router.get('/channels')
def list_channels(include_archived: bool = False):
    with projects_db.connect_closing(path('P0_PROJECT_DB')) as conn:
        return [p.to_dict() for p in projects_db.list_projects(conn, include_archived=include_archived)]


@router.patch('/channels/{pid}')
def edit_channel(pid: str, body: Channel):
    with projects_db.connect_closing(path('P0_PROJECT_DB')) as conn:
        if not projects_db.update_project(conn, pid, name=body.name, description=body.description):
            raise HTTPException(404)
        return projects_db.get_project(conn, pid).to_dict()


@router.post('/channels/{pid}/archive')
def archive_channel(pid: str):
    with projects_db.connect_closing(path('P0_PROJECT_DB')) as conn:
        return {'archived': projects_db.archive_project(conn, pid)}


@router.get('/history/{sid}')
def history(sid: str):
    # Correct visible projection, but this API materializes the WHOLE lineage.
    # Deliberately no product pagination/ID promise here.
    with SessionDB(db_path=path('P0_STATE_DB'), read_only=True) as db:
        tip = db.resolve_resume_session_id(sid)
        _, display = db.get_resume_conversations(tip)
        items = _history_to_messages(display)
        return {'tip': tip, 'visible': [
            {'role': x['role'], 'text': x['text'], 'row_id': x.get('row_id')}
            for x in items if x['role'] in ('user', 'assistant')]}


@router.get('/events/{room_id}')
def events(room_id: str, since_seq: int = 0, limit: int = 2):
    if not 1 <= limit <= 20:
        raise HTTPException(400)
    try:
        return hosted_rooms.read_events(path('P0_ROOM_DB'), room_id=room_id,
                                        since_seq=since_seq, limit=limit)
    except hosted_rooms.HostedRoomError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/send/{room_id}')
def send(room_id: str, body: Send):
    # This writes a durable room event ONLY; it is not an atomic execution admission.
    try:
        return hosted_rooms.append_event(
            path('P0_ROOM_DB'), room_id=room_id, event_id=hosted_rooms.user_event_id(body.send_id),
            kind='message.user', actor={'kind': 'user', 'id': 'synthetic-user'},
            payload={'text': body.text}, authority_gateway_id='synthetic-owner', authority_epoch=1)
    except hosted_rooms.EventConflictError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post('/read/{room_id}/{user_id}')
def mark_read(room_id: str, user_id: str, body: Read):
    # Small plugin-owned metadata proof. No transcript/body duplication.
    if body.cursor < 0 or len(room_id) > 128 or len(user_id) > 128:
        raise HTTPException(400)
    dbpath = path('P0_META_DB')
    with sqlite3.connect(dbpath) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS reads (room TEXT, user TEXT, cursor INTEGER NOT NULL, PRIMARY KEY(room,user))')
        conn.execute('INSERT INTO reads VALUES (?,?,?) ON CONFLICT(room,user) DO UPDATE SET cursor=MAX(cursor,excluded.cursor)',
                     (room_id, user_id, body.cursor))
        return {'cursor': conn.execute('SELECT cursor FROM reads WHERE room=? AND user=?', (room_id,user_id)).fetchone()[0]}


@router.get('/read/{room_id}/{user_id}')
def get_read(room_id: str, user_id: str):
    with sqlite3.connect(path('P0_META_DB')) as conn:
        row = conn.execute('SELECT cursor FROM reads WHERE room=? AND user=?', (room_id,user_id)).fetchone()
        return {'cursor': row[0] if row else 0}
