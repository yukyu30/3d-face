// Fluent 3D Emoji のメタデータ
// URL: https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/{folder}/3D/{file}_3d.png
const BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets";

export interface EmojiDef {
  name: string;
  keywords: string[];
  url: string;
}

function e(folder: string, file: string, name: string, keywords: string[]): EmojiDef {
  return { name, keywords, url: `${BASE}/${encodeURIComponent(folder)}/3D/${file}_3d.png` };
}

export const EMOJIS: EmojiDef[] = [
  // スマイリー
  e("Grinning face", "grinning_face", "😀", ["smile", "grin", "笑顔"]),
  e("Grinning face with big eyes", "grinning_face_with_big_eyes", "😃", ["smile", "happy"]),
  e("Grinning face with smiling eyes", "grinning_face_with_smiling_eyes", "😄", ["laugh", "笑い"]),
  e("Beaming face with smiling eyes", "beaming_face_with_smiling_eyes", "😁", ["beam", "grin"]),
  e("Grinning squinting face", "grinning_squinting_face", "😆", ["laugh", "xd"]),
  e("Face with tears of joy", "face_with_tears_of_joy", "😂", ["joy", "laugh", "lol", "涙"]),
  e("Rolling on the floor laughing", "rolling_on_the_floor_laughing", "🤣", ["rofl", "laugh"]),
  e("Smiling face with heart-eyes", "smiling_face_with_heart-eyes", "😍", ["love", "heart", "ハート"]),
  e("Star-struck", "star-struck", "🤩", ["star", "wow", "星"]),
  e("Face blowing a kiss", "face_blowing_a_kiss", "😘", ["kiss", "キス"]),
  e("Smiling face with halo", "smiling_face_with_halo", "😇", ["angel", "天使"]),
  e("Winking face", "winking_face", "😉", ["wink", "ウインク"]),
  e("Thinking face", "thinking_face", "🤔", ["think", "考え"]),
  e("Zany face", "zany_face", "🤪", ["crazy", "wild"]),
  e("Face with hand over mouth", "face_with_hand_over_mouth", "🤭", ["oops", "giggle"]),
  e("Shushing face", "shushing_face", "🤫", ["quiet", "secret", "秘密"]),
  e("Smiling face with sunglasses", "smiling_face_with_sunglasses", "😎", ["cool", "sunglasses", "サングラス"]),
  e("Nerd face", "nerd_face", "🤓", ["nerd", "glasses"]),
  e("Face with monocle", "face_with_monocle", "🧐", ["monocle", "inspect"]),
  e("Disguised face", "disguised_face", "🥸", ["disguise", "変装"]),
  e("Partying face", "partying_face", "🥳", ["party", "celebrate", "パーティ"]),
  e("Smirking face", "smirking_face", "😏", ["smirk"]),
  e("Unamused face", "unamused_face", "😒", ["unamused", "meh"]),
  e("Face with rolling eyes", "face_with_rolling_eyes", "🙄", ["rolling eyes"]),
  e("Grimacing face", "grimacing_face", "😬", ["grimace", "awkward"]),
  e("Lying face", "lying_face", "🤥", ["lie", "pinocchio"]),
  e("Pensive face", "pensive_face", "😔", ["sad", "悲しい"]),
  e("Sleepy face", "sleepy_face", "😪", ["sleepy", "眠い"]),
  e("Drooling face", "drooling_face", "🤤", ["drool", "yummy"]),
  e("Sleeping face", "sleeping_face", "😴", ["sleep", "zzz", "寝る"]),
  e("Face with medical mask", "face_with_medical_mask", "😷", ["mask", "sick", "マスク"]),
  e("Face with thermometer", "face_with_thermometer", "🤒", ["sick", "fever"]),
  e("Sneezing face", "sneezing_face", "🤧", ["sneeze", "くしゃみ"]),
  e("Ghost", "ghost", "👻", ["ghost", "おばけ"]),
  e("Alien", "alien", "👽", ["alien", "宇宙人"]),
  e("Robot", "robot", "🤖", ["robot", "ロボット"]),
  e("Pile of poo", "pile_of_poo", "💩", ["poo", "poop", "うんち"]),
  e("Clown face", "clown_face", "🤡", ["clown", "ピエロ"]),
  e("Jack-o-lantern", "jack-o-lantern", "🎃", ["halloween", "pumpkin", "かぼちゃ"]),
  e("Skull", "skull", "💀", ["skull", "death", "ドクロ"]),
  // ジェスチャー
  e("Thumbs up", "thumbs_up", "👍", ["thumbs up", "good", "いいね"]),
  e("Victory hand", "victory_hand", "✌️", ["peace", "v", "ピース"]),
  e("OK hand", "ok_hand", "👌", ["ok", "good"]),
  e("Waving hand", "waving_hand", "👋", ["wave", "hi", "バイバイ"]),
  e("Clapping hands", "clapping_hands", "👏", ["clap", "拍手"]),
  // ハート
  e("Red heart", "red_heart", "❤️", ["heart", "love", "ハート"]),
  e("Sparkling heart", "sparkling_heart", "💖", ["sparkle", "heart", "キラキラ"]),
  e("Fire", "fire", "🔥", ["fire", "hot", "炎"]),
  e("Star", "star", "⭐", ["star", "星"]),
  e("Rainbow", "rainbow", "🌈", ["rainbow", "虹"]),
  e("Sun with face", "sun_with_face", "🌞", ["sun", "太陽"]),
];
