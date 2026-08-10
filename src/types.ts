export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  created_at: number;
  character_id: number | null;
}

export interface RaceText {
  id: number;
  content: string;
}

export interface CharacterRow {
  id: number;
  name: string;
  image_path: string;
  created_at: number;
}
