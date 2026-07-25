// FizzBuzz, matched on a pair of remainders.

let fizzbuzz n =
  match (n % 3, n % 5) with
  | (0, 0) -> "FizzBuzz"
  | (0, _) -> "Fizz"
  | (_, 0) -> "Buzz"
  | _ -> string_of_int n

do iter (fun n -> println (fizzbuzz n)) (range 1 21)
