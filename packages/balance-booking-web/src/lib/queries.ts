export const LIST_CLASSES = /* GraphQL */ `
  query ListClasses($fromDate: String, $toDate: String) {
    listClasses(fromDate: $fromDate, toDate: $toDate) {
      classInstanceId
      classTypeSlug
      classTypeName
      level
      format
      startsAt
      durationMin
      capacity
      booked
      instructor
      priceGBP
      membersOnly
    }
  }
`;

export const MY_PROFILE = /* GraphQL */ `
  query MyProfile {
    myProfile {
      userId
      email
      name
      phone
      parqCompletedAt
      role
    }
  }
`;

export const MY_BOOKINGS = /* GraphQL */ `
  query MyBookings {
    myBookings {
      bookingId
      classInstanceId
      classDate
      classTypeName
      startsAt
      status
      paymentMethod
      createdAt
    }
  }
`;

export const SUBMIT_PARQ = /* GraphQL */ `
  mutation SubmitParq($input: ParqInput!) {
    submitParq(input: $input) {
      userId
      parqCompletedAt
    }
  }
`;

export const BOOK_BASKET = /* GraphQL */ `
  mutation BookBasket($items: [BasketItemInput!]!) {
    bookBasket(items: $items) {
      bookings {
        bookingId
        classTypeName
        startsAt
        status
      }
      totalGBP
      paymentMethod
    }
  }
`;

export const CANCEL_BOOKING = /* GraphQL */ `
  mutation CancelBooking($bookingId: ID!) {
    cancelBooking(bookingId: $bookingId) {
      bookingId
      status
    }
  }
`;

export const ADMIN_CREATE_CLASS = /* GraphQL */ `
  mutation AdminCreateClass($input: CreateClassInput!) {
    adminCreateClass(input: $input) {
      classInstanceId
      classTypeName
      startsAt
    }
  }
`;

export const ADMIN_UPDATE_CLASS = /* GraphQL */ `
  mutation AdminUpdateClass($input: UpdateClassInput!) {
    adminUpdateClass(input: $input) {
      classInstanceId
      classTypeName
      startsAt
      durationMin
      capacity
      booked
      instructor
      priceGBP
      membersOnly
    }
  }
`;

export const ADMIN_DELETE_CLASS = /* GraphQL */ `
  mutation AdminDeleteClass($classInstanceId: ID!, $classDate: String!) {
    adminDeleteClass(classInstanceId: $classInstanceId, classDate: $classDate) {
      classInstanceId
      cancelledBookings
    }
  }
`;

export const ADMIN_LIST_BOOKINGS = /* GraphQL */ `
  query AdminListBookings($classInstanceId: ID!) {
    adminListBookings(classInstanceId: $classInstanceId) {
      bookingId
      userId
      classTypeName
      startsAt
      status
      paymentMethod
      createdAt
    }
  }
`;
