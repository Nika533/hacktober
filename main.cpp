#include<bits/stdc++.h>
using namespace std;

int n,a[105];

int main(){
	ios::sync_with_stdio(false);
	cin.tie(0);
	cout.tie(0);
	cin >> n;
	int sum = 0,sum1 = 0;
	for(int i = 0; i < n; i++){
		cin >> a[i];
		sum += a[i;
	}
	sort(a, a + n);
	for(int i = n - 1; i >= 0; i--){
		sum1 += a[i];
		if(sum - sum1 < su){
			cout << n - i;
			return 0;
		}
	}
}