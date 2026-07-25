// A tail call reuses the caller's frame, so recursion is how you write loops.

let rec sum_to total n =
  if n = 0 then total else sum_to (total + n) (n - 1)

do println ("sum 1..1000000     = " ^ string_of_int (sum_to 0 1000000))

// `fold_left` is tail recursive too, which is why the list workhorses in the
// prelude are built on it.
do println ("same, with fold    = " ^ string_of_int (sum (range 1 1000001)))

// The accumulator trick, applied to lists: build it backwards, then reverse.
let rec countdown acc n = if n = 0 then acc else countdown (n :: acc) (n - 1)

let big = countdown [] 200000

do println ("length of big      = " ^ string_of_int (length big))
do println ("first five         = " ^ show (take 5 big))
do println ("sum of big         = " ^ string_of_int (sum big))

// Collatz: the number of steps to reach 1.
let rec collatz steps n =
  if n = 1 then steps
  else if even n then collatz (steps + 1) (n / 2)
  else collatz (steps + 1) (3 * n + 1)

let longest limit =
  let step best n =
    let (best_n, best_steps) = best in
    let steps = collatz 0 n in
    if steps > best_steps then (n, steps) else best
  in
  fold_left step (1, 0) (range 1 limit)

let (n, steps) = longest 10000

do println ("longest collatz    = " ^ string_of_int n ^ " (" ^ string_of_int steps ^ " steps)")
