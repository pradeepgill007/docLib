import { knex } from 'knex';
import {
  format,
  add,
  getHours,
  getMinutes,
  differenceInMinutes,
} from 'date-fns';

// Please keep this named export as it is.
export const knexClient = knex({
  client: 'sqlite3',
  connection: ':memory:',
  useNullAsDefault: true,
});

// Please keep this named export as it is.
export const migrate = () =>
  knexClient.schema.createTable('events', (table) => {
    table.increments();
    table.dateTime('starts_at').notNullable();
    table.dateTime('ends_at').notNullable();
    table.enum('kind', ['appointment', 'opening']).notNullable();
    table.boolean('weekly_recurring');
  });

/**
 * Formate the given date
 * @param date  date that need to be formatted
 * @param formate  formate in which date need to be formatted
 * @returns the formatted date
 */
const formateDate = (date, formate) => format(new Date(date), formate);

/**
 * Sort the given array by date
 * @param data  array that need to be sorted
 * @returns sorted array
 */
const sortArrayByDate = (data) => {
  return data.sort((slot, nextSlot) => {
    let dateA = new Date(slot.starts_at).getTime();
    let dateB = new Date(nextSlot.starts_at).getTime();
    return dateA > dateB ? 1 : -1;
  });
};

/**
 * Extrace hours and min in the formatted way
 * @param dateTime dateTime that need to be formatted
 * @returns hours and min in "HH:MM" format
 */
const getFormattedTime = (dateTime) => {
  const slotHour = getHours(new Date(dateTime));
  const slotMin = ('0' + getMinutes(new Date(dateTime))).slice(-2);
  return `${slotHour}:${slotMin}`;
};

/**
 * 
 * @param obj object who's last key need to be extract
 * @returns last kex of a given object
 */
const getLastKey = (obj) => Object.keys(obj)[Object.keys(obj).length - 1];

/**
 * 
 * @param dataArray array of appointments events
 * @param availabilities availability object
 * @returns booked slots with formatted date as key and array of time slots as value
 */
const getBookedSlots = (dataArray, availabilities) => {
  const slotsObj = {};
  const bookedSlotsLength = dataArray.length;
  const lastDay = getLastKey(availabilities);

  for (let i = 0; i < bookedSlotsLength; i++) {
    if (new Date(dataArray[i].starts_at) <= new Date(lastDay)) {
      let startSlot = new Date(dataArray[i].starts_at);
      const formatedDate = formateDate(dataArray[i].starts_at, 'yyyy-MM-dd');

      do {
        const currentSlot = getFormattedTime(startSlot);

        if (slotsObj[formatedDate]) {
          slotsObj[formatedDate].push(currentSlot);
        } else {
          slotsObj[formatedDate] = [];
          slotsObj[formatedDate].push(currentSlot);
        }
        startSlot = add(startSlot, { minutes: 30 });
      } while (
        differenceInMinutes(
          new Date(dataArray[i].ends_at),
          new Date(startSlot)
        ) >= 30
      );
    } else {
      break;
    }
  }

  return slotsObj;
};

/**
 * 
 * @param availabilities object of all available dates
 * @param formatedDate date time for with slot need to be checked
 * @param bookedSlots booked event Date time
 * @param currentSlot current event Date time
 * @returns availabe slots
 */
const filterAvailableSots = (availabilities, formatedDate, bookedSlots, currentSlot) => {
  if (
    availabilities[formatedDate] &&
    (!bookedSlots[formatedDate] ||
      (bookedSlots[formatedDate] &&
        bookedSlots[formatedDate].indexOf(currentSlot) == -1))
  ) {
    availabilities[formatedDate].push(currentSlot);
  }
  return availabilities;
};

/**
 * 
 * @param date date for which availabe slots need to check
 * @returns next 7 days availabe slots from the given date
 */
const getAvailabilities = async (date) => {

  // get all data from DB
  const dbEvents = await knexClient.select('*').from('events');

  // Filter booked/appointment slots
  let bookedSlotsFromDB = dbEvents.filter((slot) => slot.kind == 'appointment');

  // Filter open slots
  let openSlotsFromDB = dbEvents.filter((slot) => slot.kind == 'opening');

  // Sort booked and open slots array by date
  bookedSlotsFromDB = sortArrayByDate(bookedSlotsFromDB);
  openSlotsFromDB = sortArrayByDate(openSlotsFromDB);

  // Available slots object
  let availabilities = {};

  // loop for next 7 days from given date
  for (let day = 0; day < 7; day++) {
    const nextDay = add(new Date(date), { days: day });
    const formatedDate = formateDate(nextDay, 'yyyy-MM-dd');
    availabilities[formatedDate] = [];
  }

  // get booked appointments dats
  const bookedSlots = getBookedSlots(bookedSlotsFromDB, availabilities);

  const openSlotsLength = openSlotsFromDB.length;
  const openLastDay = getLastKey(availabilities);

  // loop over open slots to add time in available slot object
  for (let i = 0; i < openSlotsLength; i++) {

    // As open slot array is sorted by date then loop till 7 days
    if (new Date(openSlotsFromDB[i].starts_at) <= new Date(openLastDay)) {
      let startSlot = new Date(openSlotsFromDB[i].starts_at);
      const formatedDate = formateDate(openSlotsFromDB[i].starts_at, 'yyyy-MM-dd');

      // add on time till event reached the end time by 30 min slot difference
      do {
        const currentSlot = getFormattedTime(startSlot);

        // of event is weekely recouring then add next 7 days to the given date
        if (openSlotsFromDB[i].weekly_recurring) {
          let inputFormattedDate = formateDate(openSlotsFromDB[i].starts_at, 'yyyy-MM-dd');

          // run loop while current event date matched the given date by the difference of 7 days
          while (!availabilities[inputFormattedDate]) {
            inputFormattedDate = add(new Date(inputFormattedDate), { days: 7 });
            inputFormattedDate = formateDate(inputFormattedDate, 'yyyy-MM-dd');
          }

          // pass open slot and booked slot, to remove time if apointment is already booked
          availabilities = filterAvailableSots(availabilities, inputFormattedDate, bookedSlots, currentSlot);
        } else {
          // if event is not recursive by 7 days
          availabilities = filterAvailableSots(availabilities, formatedDate, bookedSlots, currentSlot);
        }

        // add 30 min to the current event start time to check for next slot till event end time.
        startSlot = add(startSlot, { minutes: 30 });
      } while (
        differenceInMinutes(
          new Date(openSlotsFromDB[i].ends_at),
          new Date(startSlot)
        ) >= 30
      );
    } else {
      break;
    }
  }

  return availabilities;
};

// Please keep this default export as it is.
export default getAvailabilities;
