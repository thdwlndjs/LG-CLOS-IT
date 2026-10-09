export function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid calendar month");
  const [year, number] = month.split("-").map(Number);
  if (number < 1 || number > 12) throw new Error("Invalid calendar month");
  return {
    from: month + "-01",
    to:
      month +
      "-" +
      String(new Date(year, number, 0).getDate()).padStart(2, "0"),
    leading: new Date(year, number - 1, 1).getDay(),
  };
}
