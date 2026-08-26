const { prisma } = require('../db/connection');
const { DOC_FORMAT } = require('../../shared/constants');

function pad(n, width) {
  return String(n).padStart(width, '0');
}

async function nextCardNumber() {
  const year = new Date().getFullYear();
  const prefix = `${DOC_FORMAT.CARD_PREFIX}-${year}-`;
  const row = await prisma.patients.findFirst({
    where: { cardNumber: { startsWith: prefix } },
    orderBy: { id: 'desc' },
    select: { cardNumber: true },
  });
  const lastSeq = row ? Number(row.cardNumber.slice(prefix.length)) : 0;
  return `${prefix}${pad(lastSeq + 1, 6)}`;
}

async function nextTicketNumber(dateISO) {
  const compact = dateISO.replaceAll('-', '');
  const prefix = `${DOC_FORMAT.TICKET_PREFIX}-${compact}-`;
  const row = await prisma.appointment.findFirst({
    where: { ticketNumber: { startsWith: prefix } },
    orderBy: { id: 'desc' },
    select: { ticketNumber: true },
  });
  const lastSeq = row ? Number(row.ticketNumber.slice(prefix.length)) : 0;
  return `${prefix}${pad(lastSeq + 1, 3)}`;
}

async function nextPrescriptionNumber() {
  const year = new Date().getFullYear();
  const prefix = `${DOC_FORMAT.PRESCRIPTION_PREFIX}-${year}-`;
  const row = await prisma.prescription.findFirst({
    where: { prescriptionNumber: { startsWith: prefix } },
    orderBy: { id: 'desc' },
    select: { prescriptionNumber: true },
  });
  const lastSeq = row ? Number(row.prescriptionNumber.slice(prefix.length)) : 0;
  return `${prefix}${pad(lastSeq + 1, 6)}`;
}

module.exports = { nextCardNumber, nextTicketNumber, nextPrescriptionNumber };
