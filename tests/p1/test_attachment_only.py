"""Attachment-only message validation retains transaction and idempotency boundaries."""
import pytest
from hermes_app.storage import Store


def test_attachment_only_receipt_is_durable_scoped_and_immutable(tmp_path):
    store = Store(tmp_path / 'metadata.sqlite')
    thread = store.create_thread('project', 'files', 'session-files', '')
    other = store.create_thread('project', 'other', 'session-other', '')
    ids = [f'att_{i:032x}' for i in range(2)]
    for item in ids:
        store.attachment_add(thread, item, 'image.png', 'image/png', 70)
    receipt, created = store.accept(thread, 'files-only', '', ids)
    assert created
    again = Store(tmp_path / 'metadata.sqlite')
    assert again.accept(thread, 'files-only', '', ids) == (receipt, False)
    assert [a['id'] for a in again.receipt_attachments(receipt['id'])] == ids
    assert not again.attachment_delete_unattached(thread, ids[0])
    with pytest.raises(ValueError, match='conflict'):
        again.accept(thread, 'files-only', '', ids[::-1])
    with pytest.raises(ValueError, match='attachment unavailable'):
        again.accept(other, 'cross-thread', '', ids)
    with pytest.raises(ValueError, match='attachment unavailable'):
        again.accept(thread, 'reuse', '', ids)
    assert again.claim_next(thread) == (receipt['id'], '')


@pytest.mark.parametrize('text,ids', [('', []), ('  ', []), (None, ['att_x']), ('', 'att_x'), ('', ['att_missing']), ('', ['att_x'] * 9)])
def test_empty_or_invalid_file_messages_are_rejected(tmp_path, text, ids):
    store = Store(tmp_path / 'metadata.sqlite')
    thread = store.create_thread('project', 'files', 'session-files', '')
    with pytest.raises(ValueError):
        store.accept(thread, 'invalid', text, ids)
