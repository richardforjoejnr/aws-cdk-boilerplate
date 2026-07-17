export const listItems = /* GraphQL */ `
  query ListItems {
    listItems {
      pk
      sk
      name
      description
      createdAt
      updatedAt
    }
  }
`;

export const createItem = /* GraphQL */ `
  mutation CreateItem($input: CreateItemInput!) {
    createItem(input: $input) {
      pk
      sk
      name
      description
      createdAt
      updatedAt
    }
  }
`;

export const deleteItem = /* GraphQL */ `
  mutation DeleteItem($id: ID!) {
    deleteItem(id: $id) {
      pk
      sk
      name
      description
    }
  }
`;
