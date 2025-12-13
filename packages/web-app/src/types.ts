export interface Item {
  pk: string;
  sk: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemInput {
  name: string;
  description?: string;
}

export interface ListItemsResponse {
  listItems: Item[];
}

export interface CreateItemResponse {
  createItem: Item;
}

export interface DeleteItemResponse {
  deleteItem: Item;
}
