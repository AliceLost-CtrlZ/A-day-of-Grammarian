// The trial-division sieve, one line of which does all the work.

let rec sieve xs =
  match xs with
  | [] -> []
  | p :: rest -> p :: sieve (filter (fun n -> n % p <> 0) rest)

let primes limit = sieve (range 2 limit)

do println ("primes below 60: " ^ show (primes 60))
do println ("how many below 500: " ^ string_of_int (length (primes 500)))

// Twin primes: pairs that differ by two.
let twins limit =
  let ps = primes limit in
  filter (fun (a, b) -> b - a = 2) (zip ps (drop 1 ps))

do println ("twin primes below 60: " ^ show (twins 60))
