import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickedMediaName } from '../src/attachmentHelpers.ts';

test('picked media keeps the picker filename', () => {
  assert.equal(pickedMediaName('IMG_0001.MOV', 'video/quicktime', 'image'), 'IMG_0001.MOV');
  assert.equal(pickedMediaName('IMG_0002.HEIC', 'image/heic', 'photo'), 'IMG_0002.HEIC');
});

test('unnamed videos get a video extension so the adapter infers video MIME', () => {
  assert.equal(pickedMediaName(null, 'video/quicktime', 'image'), 'video.mov');
  assert.equal(pickedMediaName(undefined, 'video/mp4', 'photo'), 'video.mp4');
  assert.equal(pickedMediaName(null, null, 'video'), 'video.mp4');
  assert.equal(pickedMediaName('', 'video/quicktime', 'video'), 'video.mov');
});

test('unnamed images keep the previous names', () => {
  assert.equal(pickedMediaName(null, 'image/png', 'image'), 'image.png');
  assert.equal(pickedMediaName(null, 'image/jpeg', 'image'), 'image.jpg');
  assert.equal(pickedMediaName(null, undefined, 'photo'), 'photo.jpg');
  assert.equal(pickedMediaName(null, 'image/png', 'photo'), 'photo.png');
});

test('library picks videos and the menu records video with its own camera call', () => {
  const source = fs.readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
  assert.match(source, /launchImageLibraryAsync\(\{ mediaTypes: \['images', 'videos'\]/);
  assert.match(source, /preferredAssetRepresentationMode: ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Current/);
  assert.match(source, /launchCameraAsync\(\{ mediaTypes: \[video \? 'videos' : 'images'\]/);
  assert.match(source, /label="Record video" onPress=\{\(\) => \{ setMenuOpen\(false\); void camera\(true\); \}\}/);
});
